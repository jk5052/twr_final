'use client'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, OrbitControls, Environment, Html } from '@react-three/drei'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { resolveModelUrl } from '@/lib/assets'

interface RoomProps {
  modelPath: string
  onObjectClick: (name: string) => void
  isInteractive: (name: string) => boolean
  // 이름이 ITEM_BY_NAME 에 등록된 인터랙티브 아이템인지 (chain/intro 게이트와 무관).
  // glow registry 빌드용 — load 시점엔 isInteractive 가 항상 false 라서 분리 필요.
  isItem?: (name: string) => boolean
  // 이미 클릭해서 진행 완료된 아이템 — true 면 glow 와 클릭 둘 다 lockout.
  isUsed?: (name: string) => boolean
  // 세팅되면 해당 이름의 mesh 로 카메라 줌인. null 이면 base 시점으로 복귀.
  // R4 포스터 클릭 시 page.tsx 가 set → chain 종료 시 unset.
  zoomTarget?: string | null
  disableControls?: boolean
}

type EmissiveMat = THREE.Material & { emissive: THREE.Color; emissiveIntensity: number }
// glow registry 한 entry. 각 인터랙티브 root 별 emissive mats 와 base scale 보관.
// pulseStart: 클릭 시 performance.now() 기록 → useFrame 에서 short flash + scale bump.
type GlowMat = { mat: EmissiveMat; baseEmissive: THREE.Color; baseIntensity: number }
type GlowEntry = {
  name: string
  root: THREE.Object3D
  mats: GlowMat[]
  // 전체 Vector3 로 보관 — Spline 의 일부 root (R3 banquet_chair_WITH_COVER 처럼
  // scale=[-0.157, 0.157, 0.157] 인 mirrored mesh) 에서 setScalar(scalar) 로 적용
  // 하면 X 축의 음수 부호가 Y, Z 까지 전파되어 메시가 inverted (모든 face winding
  // 반전 + invisible). copy() + multiplyScalar(pulseScale) 로 부호 보존.
  baseScale: THREE.Vector3
  phaseOffset: number
  pulseStart: number | null
}
const GLOW_COLOR = new THREE.Color(0xffe6b0)
const HOVER_INTENSITY = 0.55
const IDLE_BASE = 0.18
const IDLE_AMP = 0.06
const IDLE_RATE = 1.6
const PULSE_DUR = 0.24
const PULSE_INTENSITY_PEAK = 0.5
const PULSE_SCALE_PEAK = 0.04

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
  // R5: 원본 Spline 'Camera' 기준에서 시점을 살짝 뒤로 빼고, target 을 좌측 상단으로
  // 미세 회전 (statue (-15,-16,-12) 쪽으로 약간). Door (16,-16,-11.5) 는 화면 오른쪽
  // 가장자리에 왼쪽 끝만 살짝 걸치는 정도로 남음.
  '/models/r5.glb': {
    pos:    [-7.50, -5.50, 9.00] as const,
    target: [-3.00, -11.50, -12.00] as const,
    fov: 48,
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

// R4 포스터 텍스처 swap. Spline GLB 내장 포스터 텍스처가 저해상도라 줌인 시 깨져 보임 →
// public/assets/<itemId>.png 로 런타임 교체. root 이름은 events.ts itemId 와 1:1.
// 적용 대상: 자식 mesh 중 원래 .map 이 있는 (이미지 plane 으로 추정되는) mesh 만.
// frame/back 같이 solid color mesh 는 건드리지 않음.
const POSTER_TEXTURE_MAP: Record<string, string> = {
  poster_art:        '/assets/poster_art.png',
  poster_comic:      '/assets/poster_comic.png',
  poster_family:     '/assets/poster_family.png',
  poster_psychology: '/assets/poster_psychology.png',
  poster_relation:   '/assets/poster_relation.png',
}
const POSTER_TEXTURE_ROOMS = new Set(['/models/r4.glb'])

// 방별 light intensity 부스트. cm-scale dim 룸은 decay=0 + n× boost.
// 룸 무드를 시각적으로 더 어둡고 cozy 하게 잡기 위해 boost 를 룸별로 잘게 튜닝.
// 이전 default 12× 는 발표 톤에 비해 너무 밝아서 모든 룸이 평평한 형광등 느낌이었음.
// 흰 Void(finalroom) 은 인테리어가 밝아 0.15× 로 dim 유지.
type LightBoost = { spot: number; point: number; directional: number; decayZero: boolean }
const DEFAULT_LIGHT_BOOST: LightBoost = { spot: 6, point: 1.5, directional: 0.25, decayZero: true }
const LIGHT_BOOST: Record<string, LightBoost> = {
  '/models/finalroom.glb': { spot: 0.15, point: 0.15, directional: 0.15, decayZero: false },
  // R1: cozy 거실 — 캔들/스탠드 톤. 강한 천장등 인상 피하기.
  '/models/r1.glb':        { spot: 5,    point: 1.2,  directional: 0.3,  decayZero: true  },
  // R2: 어두운 복도. mirror/cabinet/벽지 반사로 쉽게 밝아져 더 낮춘다.
  '/models/r2.glb':        { spot: 3,    point: 0.8,  directional: 0.15, decayZero: true  },
  // R3: 무대/시상식. dim 한 극장 톤, microphone red light 강조.
  '/models/r3.glb':        { spot: 4,    point: 1,    directional: 0.2,  decayZero: true  },
}

// GLB 안의 named 카메라가 transform 이상해서 (0.01 scale 등) raycast 가 빈 공간 향할 때
// 강제로 mesh bbox 기반 fit 을 사용. R2 가 대표적: 'Camera' 노드의 world matrix 가
// 0.01x 스케일로 들어와서 카메라 forward 가 거의 0 벡터가 됨.
const FORCE_BBOX_FIT: Record<string, boolean> = {
  '/models/r2.glb': true,
}

// bbox-fit fallback 의 dist 에 곱해지는 룸별 후진 배율. 1.0 = 자동 fit 그대로,
// >1 = 카메라를 +Z 로 더 빼서 같은 각도로 살짝 줌아웃. 룸 2 는 캐비닛이 fit
// 프레임 밖으로 살짝 잘려 1.25 로 살짝 빼준다.
const BBOX_FIT_BACK_MULT: Record<string, number> = {
  '/models/r2.glb': 1.25,
}

// 디버그 토글: true 면 isInteractive 필터 bypass 하고 hit 된 mesh 이름을 그대로
// onObjectClick 으로 전달. R3F raycast 자체는 동작하는데 events.ts mapping 만 빠진
// 상황을 검증하기 위함.
const DEBUG_ALL_HITS = true

function Scene({ modelPath, onObjectClick, isInteractive, isItem, isUsed, zoomTarget }: RoomProps) {
  // modelPath stays a stable id ('/models/r1.glb') for the override tables;
  // only the URL handed to useGLTF gets rewritten to an external CDN when set.
  const { scene, cameras } = useGLTF(resolveModelUrl(modelPath))
  const { camera, controls } = useThree() as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null }
  const fittedFor = useRef<string | null>(null)
  // canvas-level pointerdown 이 사용. R3F 이벤트 시스템이 일부 GLB scene 에서
  // primitive 자식 mesh 까지 raycast 결과를 propagate 못 하는 케이스 우회용.
  const meshesRef = useRef<THREE.Object3D[]>([])
  // glow/hover/pulse 모두 useFrame 에서 frame-driven 으로 처리. hoveredNameRef 는
  // 현재 호버된 root 이름, glowsRef 는 인터랙티브 아이템 root 의 emissive mat 등록부.
  const glowsRef = useRef<GlowEntry[]>([])
  const hoveredNameRef = useRef<string | null>(null)
  const isInteractiveRef = useRef(isInteractive)
  const onObjectClickRef = useRef(onObjectClick)
  const isItemRef = useRef(isItem)
  const isUsedRef = useRef(isUsed)
  isInteractiveRef.current = isInteractive
  onObjectClickRef.current = onObjectClick
  isItemRef.current = isItem
  isUsedRef.current = isUsed
  // 카메라 줌 애니메이션 상태. fit 직후 base 를 저장 → zoomTarget 이 set 되면
  // target object 의 world bbox center 로 lerp, null 이면 base 로 복귀.
  const baseCamRef = useRef<{ pos: THREE.Vector3; quat: THREE.Quaternion; fov: number } | null>(null)
  const zoomTargetRef = useRef<string | null>(zoomTarget ?? null)
  zoomTargetRef.current = zoomTarget ?? null

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
      // Spline export quirk: 일부 mat 이 alphaMode=BLEND 로 export 되지만 실제론
      // opacity=1 + alphaMap 없음 → three.js 가 transparent=true + depthWrite=false
      // 로 import → 다른 메시 뒤로 사라짐 (R5 statue 가 대표 케이스). 명백히 opaque
      // 인 mat 은 transparent flag 정정.
      const matsArr = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of matsArr) {
        if (!mat) continue
        const mm = mat as THREE.Material & { opacity?: number; alphaMap?: unknown; alphaTest?: number }
        if (mm.transparent && (mm.opacity ?? 1) >= 0.99 && !mm.alphaMap && (mm.alphaTest ?? 0) === 0) {
          mm.transparent = false
          mm.depthWrite = true
          mm.needsUpdate = true
        }
      }
      // 또 다른 Spline quirk: 일부 root 노드가 음수 스케일 (예: R3 'banquet chair
      // WITH COVER' = scale [-0.157, 0.157, 0.157]) 으로 export 됨. 음수 determinant
      // 면 face winding 이 반전되어 front-face culling 으로 메시 전체가 사라짐
      // (three.js 가 보통 자동 flip 하지만 nested transform 누적 시 누락되는 경우
      // 관찰됨). mirrored 매트릭스 감지 시 DoubleSide 로 안전망.
      m.updateWorldMatrix(true, false)
      const det = m.matrixWorld.determinant()
      if (det < 0) {
        for (const mat of matsArr) {
          if (!mat) continue
          ;(mat as THREE.Material).side = THREE.DoubleSide
          ;(mat as THREE.Material).needsUpdate = true
        }
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

    // R4 한정: 포스터 root (poster_art 등) 의 자식 mesh 중 .map 을 가진 것을 찾아
    // /public/assets/<itemId>.png 로 교체. flipY=false 는 glTF UV 컨벤션 (image
    // 원점 좌상단), colorSpace=SRGB 는 PBR 라이팅과 톤매핑이 색을 올바르게 해석
    // 하게 함. color 는 흰색으로 초기화해서 texture 가 mat.color 로 tint 되지 않게.
    // 적용 후 needsUpdate=true 로 GPU 업로드 트리거. 매칭되는 mesh 가 없으면
    // (Spline export 시 map 누락) 첫 번째 mesh 에 fallback 으로 적용.
    if (POSTER_TEXTURE_ROOMS.has(modelPath)) {
      const loader = new THREE.TextureLoader()
      for (const [name, src] of Object.entries(POSTER_TEXTURE_MAP)) {
        const root = scene.getObjectByName(name)
        if (!root) { console.log('[Room] poster root not found:', name); continue }
        const tex = loader.load(src)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = false
        tex.anisotropy = 8
        let applied = 0
        const fallbackMats: THREE.MeshStandardMaterial[] = []
        root.traverse((c) => {
          const mesh = c as THREE.Mesh
          if (!mesh.isMesh) return
          const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of ms) {
            if (!m) continue
            const mm = m as THREE.MeshStandardMaterial
            fallbackMats.push(mm)
            if (!mm.map) continue
            mm.map = tex
            if (mm.color) mm.color.setHex(0xffffff)
            mm.needsUpdate = true
            applied++
          }
        })
        if (applied === 0 && fallbackMats.length > 0) {
          const mm = fallbackMats[0]
          mm.map = tex
          if (mm.color) mm.color.setHex(0xffffff)
          mm.needsUpdate = true
        }
      }
    }

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
      // 실제 fit distance 를 그대로 사용 (최소 2 만 보장). 룸별 후진 배율 적용.
      const backMult = BBOX_FIT_BACK_MULT[modelPath] ?? 1.0
      const dist = Math.max(2, Math.max(fitH, fitW) * 1.15 * backMult)
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
    // fit 완료 직후의 카메라 state 를 base 로 보관 — 줌 해제 시 여기로 lerp 복귀.
    baseCamRef.current = {
      pos: camera.position.clone(),
      quat: camera.quaternion.clone(),
      fov: camera.fov,
    }
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

  // glow registry: 인터랙티브 root 들의 emissive mat 스냅샷 + base scale 보관.
  // fitting useEffect 와 분리한 이유 — fittedFor guard 로 fitting 은 한 번만 실행되지만,
  // Strict Mode 더블-mount (mount → unmount → re-mount) 에서 cleanup 이 registry 를
  // 비운 뒤 두 번째 mount 의 fitting effect 가 early return 하면 registry 가 빈 채로 남음.
  // 이 effect 는 항상 매 mount 에서 빌드 + cleanup 에서 복원 → Strict Mode 안전.
  useEffect(() => {
    const isItemFn = isItemRef.current
    const glows: GlowEntry[] = []
    if (isItemFn) {
      const seen = new Set<THREE.Object3D>()
      scene.traverse((o) => {
        if (!o.name || !isItemFn(o.name)) return
        let p: THREE.Object3D | null = o.parent
        while (p) { if (seen.has(p)) return; p = p.parent }
        const mats: GlowMat[] = []
        const matSet = new Set<EmissiveMat>()
        o.traverse((c) => {
          const mesh = c as THREE.Mesh
          if (!mesh.isMesh) return
          const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const m of ms) {
            if (!m || !('emissive' in m)) continue
            const mm = m as EmissiveMat
            if (matSet.has(mm)) continue
            matSet.add(mm)
            mats.push({ mat: mm, baseEmissive: mm.emissive.clone(), baseIntensity: mm.emissiveIntensity ?? 1 })
          }
        })
        if (mats.length === 0) return
        glows.push({
          name: o.name, root: o, mats,
          baseScale: o.scale.clone(),
          phaseOffset: Math.random() * Math.PI * 2,
          pulseStart: null,
        })
        seen.add(o)
      })
    }
    glowsRef.current = glows
    // 전체 root 이름을 dump — sample 6 으로 자르면 statue 처럼 뒤쪽 아이템이 누락된 듯
    // 보일 수 있어서 디버그 중에는 전체 출력.
    console.log('[Room] glow registry', modelPath, 'roots=', glows.length,
      'all=', glows.map((g) => `${g.name}(${g.mats.length})`))
    return () => {
      for (const g of glowsRef.current) {
        for (const m of g.mats) {
          m.mat.emissive.copy(m.baseEmissive)
          m.mat.emissiveIntensity = m.baseIntensity
        }
        g.root.scale.copy(g.baseScale)
      }
      glowsRef.current = []
      hoveredNameRef.current = null
      document.body.style.cursor = ''
    }
  }, [scene, modelPath])

  // glow / hover / click pulse 를 매 프레임 frame-driven 으로 적용.
  // - 사용 안 된 인터랙티브 root: 부드러운 idle breathing emissive (warm cream).
  // - hover 중 root: HOVER_INTENSITY 로 잠김.
  // - 클릭 직후 PULSE_DUR 동안: emissive flash + 살짝 scale up.
  // - 이미 사용된 (isUsed=true) root: emissive/scale 모두 base 로 복원 (lockout).
  // 줌 애니메이션 임시 객체 (alloc 회피용 — useFrame 호출 시마다 재사용).
  const _zoomTmpPos = useRef(new THREE.Vector3())
  const _zoomTmpQuat = useRef(new THREE.Quaternion())
  const _zoomTmpCenter = useRef(new THREE.Vector3())
  const _zoomTmpDir = useRef(new THREE.Vector3())
  const _zoomTmpBox = useRef(new THREE.Box3())
  const _zoomTmpMat = useRef(new THREE.Matrix4())
  const _zoomUp = useRef(new THREE.Vector3(0, 1, 0))

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const now = performance.now()
    const hovered = hoveredNameRef.current
    const used = isUsedRef.current
    // 카메라 줌 lerp — zoomTarget set 이면 target object center 로 접근, 아니면 base 로 복귀.
    // poster 처럼 평평한 mesh 는 bbox 의 가장 짧은 축이 법선이라고 가정하기보단, base
    // camera→center 방향을 따라 distance 만 줄여 접근하는 방식이 안전 (항상 카메라
    // 시점이 유지되는 면을 마주봄). 너무 가까이 붙으면 포스터가 화면을 통째로 채워
    // 부담스러우므로 distance·FOV 모두 보수적으로.
    const base = baseCamRef.current
    if (base) {
      const target = zoomTargetRef.current
      let tgtPos = base.pos
      let tgtQuat = base.quat
      let tgtFov = base.fov
      if (target) {
        const obj = scene.getObjectByName(target)
        if (obj) {
          _zoomTmpBox.current.setFromObject(obj)
          const center = _zoomTmpBox.current.getCenter(_zoomTmpCenter.current)
          const sz = _zoomTmpBox.current.getSize(new THREE.Vector3()).length()
          const dir = _zoomTmpDir.current.subVectors(center, base.pos).normalize()
          const dist = Math.max(sz * 0.95, 1.4)
          tgtPos = _zoomTmpPos.current.copy(center).addScaledVector(dir, -dist)
          const lookAt = _zoomTmpMat.current.lookAt(tgtPos, center, _zoomUp.current)
          tgtQuat = _zoomTmpQuat.current.setFromRotationMatrix(lookAt)
          tgtFov = base.fov * 0.88
        }
      }
      const rate = 0.09
      camera.position.lerp(tgtPos, rate)
      camera.quaternion.slerp(tgtQuat, rate)
      const newFov = THREE.MathUtils.lerp(camera.fov, tgtFov, rate)
      if (Math.abs(newFov - camera.fov) > 0.01) {
        camera.fov = newFov
        camera.updateProjectionMatrix()
      }
    }
    for (const g of glowsRef.current) {
      let pulseI = 0, pulseScale = 1
      if (g.pulseStart != null) {
        const dt = (now - g.pulseStart) / 1000
        if (dt >= PULSE_DUR) g.pulseStart = null
        else {
          const u = dt / PULSE_DUR
          pulseI = PULSE_INTENSITY_PEAK * (1 - u)
          pulseScale = 1 + PULSE_SCALE_PEAK * Math.sin(Math.PI * u)
        }
      }
      g.root.scale.copy(g.baseScale).multiplyScalar(pulseScale)
      const isUsedNow = !!used && used(g.name)
      if (isUsedNow) {
        for (const m of g.mats) {
          m.mat.emissive.copy(m.baseEmissive)
          m.mat.emissiveIntensity = m.baseIntensity
        }
        continue
      }
      const intensity = hovered === g.name
        ? HOVER_INTENSITY + pulseI
        : IDLE_BASE + IDLE_AMP * Math.sin(t * IDLE_RATE + g.phaseOffset) + pulseI
      for (const m of g.mats) {
        m.mat.emissive.copy(GLOW_COLOR)
        m.mat.emissiveIntensity = intensity
      }
    }
  })

  // R3F primitive 의 onPointerDown/Move 가 일부 GLB scene 에서 fire 안 되는 문제 우회.
  // canvas DOM 에 직접 pointerdown/move 붙이고 manual raycast 로 trail 따라 interactive
  // ancestor 찾음. R3F 의 raycaster 와 동일 로직 — camera + meshesRef.current.
  useEffect(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const setNdc = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      )
    }
    const onDown = (ev: PointerEvent) => {
      const meshes = meshesRef.current
      if (!meshes.length) return
      setNdc(ev)
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(meshes, false)
      if (!hits.length) { console.log('[Room][click] no hit'); return }
      let obj: THREE.Object3D | null = hits[0].object
      const isI = isInteractiveRef.current
      const onClick = onObjectClickRef.current
      const chain: string[] = []
      const checks: string[] = []
      while (obj) {
        if (obj.name) chain.push(obj.name)
        if (obj.name) checks.push(`${obj.name}=${isI(obj.name)}`)
        if (obj.name && isI(obj.name)) {
          console.log('[Room][click] hit=', hits[0].object.name, 'matched=', obj.name,
            'chain=', chain.join(' < '))
          // click pulse 시작 — useFrame 이 PULSE_DUR 동안 flash + scale 처리.
          const g = glowsRef.current.find((e) => e.root === obj)
          if (g) g.pulseStart = performance.now()
          onClick(obj.name)
          return
        }
        obj = obj.parent
      }
      console.log('[Room][click] missed hit=', hits[0].object.name,
        'chain=', chain.join(' < '), 'checks=', checks.join(','))
    }
    const onMove = (ev: PointerEvent) => {
      const meshes = meshesRef.current
      if (!meshes.length) return
      setNdc(ev)
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(meshes, false)
      const isI = isInteractiveRef.current
      let foundName: string | null = null
      // 첫 hit 의 부모 chain 을 수집 — 어떤 ancestor 도 interactive 아닐 때
      // 어디까지 mesh 가 잡혔는지 추적용. (디버그 한정.)
      let firstHitChain: string[] = []
      if (hits.length) {
        let obj: THREE.Object3D | null = hits[0].object
        while (obj) {
          if (obj.name) firstHitChain.push(obj.name)
          if (obj.name && isI(obj.name)) { foundName = obj.name; break }
          obj = obj.parent
        }
      }
      if (foundName !== hoveredNameRef.current) {
        hoveredNameRef.current = foundName
        document.body.style.cursor = foundName ? 'pointer' : ''
        const glowCount = glowsRef.current.length
        const inReg = foundName ? glowsRef.current.some((g) => g.name === foundName) : false
        console.log('[Room][hover]', foundName ?? '(none)', 'inRegistry=', inReg, 'registrySize=', glowCount,
          'hitChain=', firstHitChain.join(' < '))
      }
    }
    const onLeave = () => {
      if (hoveredNameRef.current !== null) {
        hoveredNameRef.current = null
        document.body.style.cursor = ''
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    }
  }, [camera, modelPath])

  return <primitive object={scene} />
}

export default function Room({ modelPath, onObjectClick, isInteractive, isItem, isUsed, zoomTarget, disableControls }: RoomProps) {
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
          IBL 은 회색 fill 용 (intensity 0.06) — mood 는 puncutal light 가 좌우. */}
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
          isItem={isItem}
          isUsed={isUsed}
          zoomTarget={zoomTarget}
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
