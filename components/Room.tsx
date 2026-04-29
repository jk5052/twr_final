'use client'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { useGLTF, OrbitControls, Environment, Html } from '@react-three/drei'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { resolveModelUrl } from '@/lib/assets'

interface RoomProps {
  modelPath: string
  onObjectClick: (name: string) => void
  isInteractive: (name: string) => boolean
  disableControls?: boolean
}

type EmissiveMat = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number }
type HoverState = { root: THREE.Object3D; saved: Map<EmissiveMat, { emissive: THREE.Color; intensity: number }> }
const HOVER_COLOR = new THREE.Color(0xffe6b0)
const HOVER_INTENSITY = 0.55

// 방별 카메라 수동 override. Spline GLB 의 export 카메라가 reference 시점과 안 맞을 때
// 사용. pos/target 은 GLB world space (Spline cm 단위). 정의 안된 modelPath 는 자동
// 카메라 선택 → bbox-fit fallback 순서로 처리.
const CAMERA_OVERRIDES: Record<string, { pos: readonly [number, number, number]; target: readonly [number, number, number]; fov: number }> = {
  // R4: Spline 'Player' 카메라 (yfov 30°). useGLTF 의 cameras[] 가 0.01 스케일로
  // decompose 되며 forward 가 거의 0 벡터가 되는 경우가 있어 명시적 override.
  // FOV 30° 는 6 개 인터랙티브 (5 posters + elevator) span (≈ 48° h) 에 모자라
  // 좌/우 끝(elevator, poster_art)이 frustum 밖으로 클립됨 → 50° 로 확장하고
  // target 도 6 개 mesh 의 centroid 근처로 옮겨 수평 분산을 맞춘다.
  '/models/r4.glb': {
    pos:    [-9.21, -7.08, -46.86] as const,
    target: [13.30, -4.53, -17.74] as const,
    fov: 50,
  },
  // Final room: 4 export 카메라 모두 동일한 'Camera' 이름 + 0.01 스케일 + znear 70
  // 으로 오작동. 'beginning vignette' 가 카메라 바로 앞 1.5 단위에 오버레이로 깔려있어
  // 별도 hide 처리(HIDDEN_MESH_PATTERNS) 와 함께 명시 시점 사용.
  '/models/finalroom.glb': {
    pos:    [0.94, 8.47, -14.84] as const,
    target: [-0.86, 7.69, -44.84] as const,
    fov: 45,
  },
}

// 방별로 숨길 mesh 이름 패턴. 카메라 바로 앞 vignette/overlay 처럼 시점을 가리는 메시를
// 시각·raycast 모두에서 제외 (visible=false + raycast=noop). 대소문자 무시 substring.
const HIDDEN_MESH_PATTERNS: Record<string, string[]> = {
  '/models/finalroom.glb': ['beginning vignette', 'beginning_vignette', 'vignette'],
}

// 방별 light intensity 부스트. R1~R5 는 dim cm-scale 이라 decay=0 + 12× boost 가 적정.
// 흰 Void(finalroom) 은 인테리어가 밝은 톤이라 GLB 원본 라이트 그대로 두면 화면이
// 하얗게 번져 위에 깔린 흰 텍스트가 안 보임 → 0.15× 로 dim 처리해 어두운 룸 톤 유지.
type LightBoost = { spot: number; point: number; directional: number; decayZero: boolean }
const DEFAULT_LIGHT_BOOST: LightBoost = { spot: 12, point: 3, directional: 0.4, decayZero: true }
const LIGHT_BOOST: Record<string, LightBoost> = {
  '/models/finalroom.glb': { spot: 0.15, point: 0.15, directional: 0.15, decayZero: false },
}

// GLB 안의 named 카메라가 transform 이상해서 (0.01 scale 등) raycast 가 빈 공간 향할 때
// 강제로 mesh bbox 기반 fit 을 사용. R2 가 대표적: 'Camera' 노드의 world matrix 가
// 0.01x 스케일로 들어와서 카메라 forward 가 거의 0 벡터가 됨.
const FORCE_BBOX_FIT: Record<string, boolean> = {
  '/models/r2.glb': true,
}

// 디버그 토글: true 면 isInteractive 필터 bypass 하고 hit 된 mesh 이름을 그대로
// onObjectClick 으로 전달. R3F raycast 자체는 동작하는데 events.ts mapping 만 빠진
// 상황을 검증하기 위함.
const DEBUG_ALL_HITS = true

function findInteractiveAncestor(
  obj: THREE.Object3D | null,
  isInteractive: (name: string) => boolean,
): THREE.Object3D | null {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (cur.name && isInteractive(cur.name)) return cur
    cur = cur.parent
  }
  return null
}

function Scene({ modelPath, onObjectClick, isInteractive }: RoomProps) {
  // modelPath stays a stable id ('/models/r1.glb') for the override tables;
  // only the URL handed to useGLTF gets rewritten to an external CDN when set.
  const { scene, cameras } = useGLTF(resolveModelUrl(modelPath))
  const { camera, controls } = useThree() as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null }
  const fittedFor = useRef<string | null>(null)
  const hoveredRef = useRef<HoverState | null>(null)
  // canvas-level pointerdown 이 사용. R3F 이벤트 시스템이 일부 GLB scene 에서
  // primitive 자식 mesh 까지 raycast 결과를 propagate 못 하는 케이스 우회용.
  const meshesRef = useRef<THREE.Object3D[]>([])
  const isInteractiveRef = useRef(isInteractive)
  const onObjectClickRef = useRef(onObjectClick)
  isInteractiveRef.current = isInteractive
  onObjectClickRef.current = onObjectClick

  // 새 GLB 로드 시 1회: GLB 안에 export 된 카메라(이름 'Camera' 또는 'Player') 의
  // world transform 을 그대로 active 카메라에 복사. 카메라가 없는 GLB 면 mesh bbox
  // FOV-fit 으로 fallback. OrbitControls 의 target 은 카메라 바로 앞으로 두어
  // (제자리 회전 모드) 위치는 고정되고 좌우상하 회전만 허용된다.
  useEffect(() => {
    if (fittedFor.current === modelPath) return
    scene.updateMatrixWorld(true)

    // 0) 수동 override 우선. 정의된 modelPath 면 GLB 카메라 무시하고 hardcode 시점.
    let used: 'glb' | 'fit' | 'override' | 'forceFit' = 'fit'
    const meshes: THREE.Object3D[] = []
    // 일부 GLB 익스포트가 mesh 의 raycast 를 비워두거나 frustumCulled 로 화면 밖 처리해서
    // pointer ray 가 못 맞는 경우가 있음. 강제로 정상화하고 인터랙티브 mesh 통계를 dump.
    let meshTotal = 0, meshVisible = 0, meshNamed = 0, meshInteractive = 0, meshRaycastFixed = 0, meshHidden = 0
    const interactiveSamples: string[] = []
    const namedSamples: string[] = []
    const hiddenPatterns = (HIDDEN_MESH_PATTERNS[modelPath] ?? []).map((s) => s.toLowerCase())
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      const m = o as THREE.Mesh
      meshTotal++
      // 카메라 시점을 가리는 vignette/overlay 메시 숨김 — visible/raycast 둘 다 차단.
      const lname = (m.name || '').toLowerCase()
      if (hiddenPatterns.length && hiddenPatterns.some((p) => lname.includes(p))) {
        m.visible = false
        m.raycast = () => {}
        meshHidden++
        return
      }
      if (m.visible) meshVisible++
      m.frustumCulled = false
      if (m.raycast !== THREE.Mesh.prototype.raycast) {
        m.raycast = THREE.Mesh.prototype.raycast
        meshRaycastFixed++
      }
      meshes.push(m)
      if (m.name) {
        meshNamed++
        if (namedSamples.length < 12) namedSamples.push(m.name)
        // load 시점엔 showIntro=true 라 isInteractive 가 false 만 반환하지만 mapping 체크
        // 자체는 스냅샷용으로 의미 있음 (이름 매칭 여부만 확인하는 용도).
        if (isInteractive(m.name)) {
          meshInteractive++
          if (interactiveSamples.length < 8) interactiveSamples.push(m.name)
        }
      }
    })
    meshesRef.current = meshes

    const ovr = CAMERA_OVERRIDES[modelPath]
    if (ovr) {
      camera.position.set(...ovr.pos)
      camera.lookAt(ovr.target[0], ovr.target[1], ovr.target[2])
      camera.fov = ovr.fov
      camera.near = 0.1
      camera.far = 10000
      camera.updateMatrix()
      camera.updateMatrixWorld(true)
      camera.updateProjectionMatrix()
      used = 'override'
    }

    // 1) GLB 카메라 — Spline 은 (a) 이름있는 'Camera'/'Player' = 디자이너 의도 시점,
    //    (b) 무명 카메라 = editor preview 잔재 를 보통 같이 export. named 카메라가
    //    있으면 그걸 우선 사용 ('Camera' > 'Player' > 그 외 named). 없을 때만 무명
    //    카메라 중에 forward ray 로 mesh-ahead 가 합리적인 것을 선택.
    const cams: THREE.Camera[] = (cameras ?? []) as THREE.Camera[]
    const forceFit = !!FORCE_BBOX_FIT[modelPath]
    type CamScore = { cam: THREE.Camera; pos: THREE.Vector3; quat: THREE.Quaternion; ahead: number }
    const scored: CamScore[] = []
    if (!ovr && !forceFit) {
      for (const c of cams) {
        c.updateMatrixWorld(true)
        const p = new THREE.Vector3(); const q = new THREE.Quaternion(); const s = new THREE.Vector3()
        c.matrixWorld.decompose(p, q, s)
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
        const hits = new THREE.Raycaster(p, fwd, 0.01, 5000).intersectObjects(meshes, false)
        const ahead = hits[0]?.distance ?? Infinity
        scored.push({ cam: c, pos: p, quat: q, ahead })
      }
    }
    // 카메라가 방 안쪽 시점이려면 forward ray 가 mesh 를 만나야 함. 디자이너가 이름 붙인
    // 카메라('Camera'/'Player') 는 의도적 시점이라 ahead 가 finite 이면 무조건 신뢰
    // (Spline cm-scale 씬은 5000+ 단위까지 정상). unnamed 카메라만 editor preview
    // 잔재 가능성 있어 1~500 범위로 제한.
    const namedOk    = (s: CamScore) => isFinite(s.ahead) && s.ahead >= 1
    const unnamedOk  = (s: CamScore) => s.ahead >= 1 && s.ahead <= 500
    const namedCamera  = scored.find((s) => s.cam.name === 'Camera' && namedOk(s))
    const namedPlayer  = scored.find((s) => s.cam.name === 'Player' && namedOk(s))
    const namedAny     = scored.find((s) => s.cam.name && s.cam.name !== 'Camera' && s.cam.name !== 'Player' && namedOk(s))
    const unnamedValid = scored.filter((s) => !s.cam.name && unnamedOk(s)).sort((a, b) => a.ahead - b.ahead)[0]
    const pick = namedCamera ?? namedPlayer ?? namedAny ?? unnamedValid
    if (ovr) {
      // override 이미 적용됨 — 카메라 자동 선택/bbox-fit 분기 둘 다 skip
    } else if (pick) {
      camera.position.copy(pick.pos)
      camera.quaternion.copy(pick.quat)
      camera.scale.set(1, 1, 1)
      const pp = pick.cam as THREE.PerspectiveCamera
      if (pp.isPerspectiveCamera) {
        camera.fov = pp.fov
      }
      // Spline export 의 near/far 을 그대로 쓰면 near plane 이 70+ 처럼 큰 값으로
      // 들어와 카메라 바로 앞 mesh 가 전부 clip 됨. 항상 안전한 값으로 강제.
      camera.near = 0.1
      camera.far  = 10000
      camera.updateMatrix()
      camera.updateMatrixWorld(true)
      camera.updateProjectionMatrix()
      used = 'glb'
    } else {
      // 2) fallback: mesh bbox FOV-fit (origin 기반 25 unit inner 로 outlier 제외)
      const INTERIOR_RADIUS = 25
      const inner = new THREE.Box3()
      const full  = new THREE.Box3()
      let innerCount = 0
      const tmp = new THREE.Box3()
      scene.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return
        tmp.makeEmpty().expandByObject(o)
        if (tmp.isEmpty() || !isFinite(tmp.min.x)) return
        full.union(tmp)
        const c = tmp.getCenter(new THREE.Vector3())
        if (c.length() < INTERIOR_RADIUS) { inner.union(tmp); innerCount++ }
      })
      const useInner = innerCount >= 5 && !inner.isEmpty()
      const box = useInner ? inner : full
      if (box.isEmpty() || !isFinite(box.min.x)) return
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)
      const fovRad = ((camera.fov ?? 50) * Math.PI) / 180
      const aspect = camera.aspect || 16 / 9
      const fitH = (size.y / 2) / Math.tan(fovRad / 2)
      const fitW = (size.x / 2) / (Math.tan(fovRad / 2) * aspect)
      // Spline scene 은 단위가 cm 라 size 가 100+ 단위까지 큼. 상한 제거하고
      // 실제 fit distance 를 그대로 사용 (최소 2 만 보장).
      const dist = Math.max(2, Math.max(fitH, fitW) * 1.15)
      camera.position.set(center.x, center.y, center.z + dist)
      camera.near = Math.max(0.01, maxDim / 1000)
      camera.far  = Math.max(100, maxDim * 20)
      camera.lookAt(center)
      camera.updateProjectionMatrix()
      console.log('[Room] bbox-fit', modelPath,
        'box.min=', box.min.x.toFixed(1), box.min.y.toFixed(1), box.min.z.toFixed(1),
        'box.max=', box.max.x.toFixed(1), box.max.y.toFixed(1), box.max.z.toFixed(1),
        'center=', center.x.toFixed(1), center.y.toFixed(1), center.z.toFixed(1),
        'dist=', dist.toFixed(1), 'useInner=', useInner, 'innerCount=', innerCount,
      )
      used = forceFit ? 'forceFit' as const : used
    }

    // 3) OrbitControls target = 카메라 위치 + forward * 0.01
    //    target 이 카메라에 거의 붙어있어 zoom/pan 꺼두면 회전만 가능 → 제자리 회전.
    if (controls) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      controls.target.copy(camera.position).addScaledVector(fwd, 0.01)
      controls.update()
    }

    // 4) GLB KHR_lights_punctual 튜닝. 모델별 부스트 표 적용.
    //    cm-scale dim 룸(R1~R5): decay=0 + spot×12 / point×3.
    //    dim Void(finalroom): spot/point/directional × 0.15 — 흰 인테리어 톤 다운.
    //    useGLTF 가 같은 modelPath 의 light 를 캐시 공유하므로 intensity 를 *= 로
    //    누적 적용하면 mount 마다 더 어두워짐. 첫 mount 때 원본을 userData 에
    //    스냅샷해서 항상 (원본 × boost) 로 set — 멱등.
    const boost = LIGHT_BOOST[modelPath] ?? DEFAULT_LIGHT_BOOST
    let lightCount = 0
    scene.traverse((o) => {
      const lt = o as THREE.Light
      if (!lt.isLight) return
      lightCount++
      lt.castShadow = false
      const ud = lt.userData as { twrOriginalIntensity?: number }
      if (ud.twrOriginalIntensity === undefined) ud.twrOriginalIntensity = lt.intensity
      const base = ud.twrOriginalIntensity
      if ((lt as THREE.PointLight).isPointLight) {
        const pl = lt as THREE.PointLight
        if (boost.decayZero) { pl.decay = 0; pl.distance = 0 }
        pl.intensity = base * boost.point
      } else if ((lt as THREE.SpotLight).isSpotLight) {
        const sp = lt as THREE.SpotLight
        if (boost.decayZero) { sp.decay = 0; sp.distance = 0 }
        sp.intensity = base * boost.spot
      } else if ((lt as THREE.DirectionalLight).isDirectionalLight) {
        lt.intensity = base * boost.directional
      }
    })

    fittedFor.current = modelPath
    if (typeof window !== 'undefined') {
      // 카메라 정면으로 ray 쏴서 가장 가까운 mesh 까지 거리 측정 (디버그)
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      const ray = new THREE.Raycaster(camera.position, fwd, 0.01, 1000)
      const hits = ray.intersectObjects(meshes, false)
      const camName = pick?.cam.name || ''
      console.log(
        '[Room] fit', modelPath, `(via ${used}${camName ? `:${camName}` : ''})`,
        'cam=', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2),
        'fwd=', fwd.x.toFixed(2), fwd.y.toFixed(2), fwd.z.toFixed(2),
        'cams=', cams.length, 'lights=', lightCount,
        'meshAhead=', hits[0]?.distance.toFixed(2) ?? 'NONE',
        hits[0]?.object.name ?? '',
      )
      console.log(
        '[Room] meshes', modelPath,
        'total=', meshTotal, 'visible=', meshVisible, 'named=', meshNamed,
        'interactive(@load)=', meshInteractive,
        'raycastFixed=', meshRaycastFixed,
        'hidden=', meshHidden,
        'namedSamples=', namedSamples,
        'interactiveSamples=', interactiveSamples,
      )
      // pointer-missed 시 호출되는 manual raycast: canvas 좌표로 NDC 변환하여
      // R3F 가 사용하는 카메라/scene 상태를 그대로 재현. R3F 와 결과 다르면 R3F
      // event system 자체 문제, 같으면 카메라가 빈 공간 향하는 게 확실.
      const w = window as unknown as { __roomDebug?: unknown }
      w.__roomDebug = {
        camera, scene, meshes,
        logMissed: (mx: number, my: number) => {
          const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
          if (!canvas) return
          const r = canvas.getBoundingClientRect()
          const ndc = new THREE.Vector2(
            ((mx - r.left) / r.width) * 2 - 1,
            -((my - r.top) / r.height) * 2 + 1,
          )
          const ray2 = new THREE.Raycaster()
          ray2.setFromCamera(ndc, camera)
          const h = ray2.intersectObjects(meshes, false)
          const fwd2 = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
          console.log('[Room] pointer missed @ canvas',
            `(${mx},${my}) ndc=(${ndc.x.toFixed(2)},${ndc.y.toFixed(2)})`,
            'cam=', camera.position.x.toFixed(1), camera.position.y.toFixed(1), camera.position.z.toFixed(1),
            'fwd=', fwd2.x.toFixed(2), fwd2.y.toFixed(2), fwd2.z.toFixed(2),
            'manualHits=', h.length,
            h[0] ? `first=${h[0].object.name || '(unnamed)'} @${h[0].distance.toFixed(1)}` : '',
          )
        },
      }
    }
  }, [scene, cameras, modelPath, camera, controls])

  // 언마운트/모델 교체 시 hover 잔여 emissive 복원.
  useEffect(() => {
    return () => {
      restoreHover()
      document.body.style.cursor = ''
    }
  }, [modelPath])

  // R3F primitive 의 onPointerDown 이 일부 GLB scene 에서 fire 안 되는 문제 우회.
  // canvas DOM 에 직접 pointerdown 붙이고 manual raycast 로 trail 따라 interactive
  // ancestor 찾음. R3F 의 raycaster 와 동일 로직 — camera + meshesRef.current.
  useEffect(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const onDown = (ev: PointerEvent) => {
      const meshes = meshesRef.current
      if (!meshes.length) return
      const r = canvas.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      )
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(meshes, false)
      if (!hits.length) {
        console.log('[Room][canvas] miss @', ev.clientX, ev.clientY, 'ndc=', ndc.x.toFixed(2), ndc.y.toFixed(2))
        return
      }
      const hit = hits[0]
      const hitName = hit.object.name || '(unnamed)'
      const p = hit.point
      let obj: THREE.Object3D | null = hit.object
      const trail: string[] = []
      const isI = isInteractiveRef.current
      const onClick = onObjectClickRef.current
      while (obj) {
        if (obj.name) trail.push(obj.name)
        if (obj.name && isI(obj.name)) {
          console.log('[Room][canvas] match', obj.name, 'hit=', hitName, '@', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), 'trail:', trail)
          onClick(obj.name)
          return
        }
        obj = obj.parent
      }
      if (DEBUG_ALL_HITS) {
        console.log('[Room][canvas][DEBUG] hit but no isInteractive match. hit=', hitName, 'trail:', trail)
        for (const n of trail) onClick(n)
        return
      }
      console.log('[Room][canvas] no match. hit=', hitName, 'trail:', trail)
    }
    canvas.addEventListener('pointerdown', onDown)
    return () => canvas.removeEventListener('pointerdown', onDown)
  }, [camera, modelPath])

  function applyHover(root: THREE.Object3D) {
    const saved = new Map<EmissiveMat, { emissive: THREE.Color; intensity: number }>()
    root.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (!(mesh as THREE.Mesh).isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (!m || !('emissive' in m)) continue
        const mm = m as EmissiveMat
        if (saved.has(mm)) continue
        saved.set(mm, { emissive: mm.emissive.clone(), intensity: mm.emissiveIntensity ?? 1 })
        mm.emissive.copy(HOVER_COLOR)
        mm.emissiveIntensity = HOVER_INTENSITY
      }
    })
    hoveredRef.current = { root, saved }
  }

  function restoreHover() {
    const cur = hoveredRef.current
    if (!cur) return
    for (const [m, s] of cur.saved) {
      m.emissive.copy(s.emissive)
      m.emissiveIntensity = s.intensity
    }
    hoveredRef.current = null
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const root = findInteractiveAncestor(e.object, isInteractive)
    if (!root) {
      if (hoveredRef.current) {
        restoreHover()
        document.body.style.cursor = ''
      }
      return
    }
    if (hoveredRef.current?.root === root) return
    if (hoveredRef.current) restoreHover()
    applyHover(root)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (hoveredRef.current) {
      restoreHover()
      document.body.style.cursor = ''
    }
  }

  return (
    <primitive
      object={scene}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    />
  )
}

export default function Room({ modelPath, onObjectClick, isInteractive, disableControls }: RoomProps) {
  return (
    <Canvas
      camera={{ position: [0, 1.5, 4], fov: 50 }}
      className="w-full h-full"
      gl={{ toneMappingExposure: 1.0 }}
      onPointerMissed={(e) => {
        // raycaster 가 scene 의 어떤 mesh 도 못 맞힘 → 카메라가 빈 공간 향하거나
        // mesh 가 ray 범위 밖. window.__roomDebug 로 카메라/scene 상태 확인 가능.
        if (e.type !== 'pointerdown' && e.type !== 'click' && e.type !== 'mousedown') return
        const dbg = (window as unknown as { __roomDebug?: { logMissed?: (mx: number, my: number) => void } }).__roomDebug
        if (dbg?.logMissed) dbg.logMissed((e as PointerEvent).clientX, (e as PointerEvent).clientY)
        else console.log('[Room] pointer missed (no mesh hit) — camera may be inside wall or facing void')
      }}
    >
      {/* GLB 안의 KHR_lights_punctual (point/spot/directional) + apartment IBL 약하게.
          R1: cozy(5) / R2,R4: dim(2-3) / R3: flashy(1+emissive) / R5: mystical(6).
          IBL 은 회색 fill 용 (intensity 0.35) — mood 는 puncutal light 가 좌우. */}
      <color attach="background" args={['#030303']} />
      <ambientLight intensity={0.04} />
      <Suspense fallback={
        <Html center>
          <div className="text-white/40 text-[10px] tracking-[0.4em] uppercase animate-pulse">
            loading…
          </div>
        </Html>
      }>
        <Environment preset="apartment" environmentIntensity={0.06} background={false} />
        <Scene
          modelPath={modelPath}
          onObjectClick={onObjectClick}
          isInteractive={isInteractive}
        />
      </Suspense>
      {!disableControls && (
        <OrbitControls
          makeDefault
          enableZoom={false}
          enablePan={false}
          enableRotate={true}
          rotateSpeed={-0.4}
        />
      )}
    </Canvas>
  )
}
