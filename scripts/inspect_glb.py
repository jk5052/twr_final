"""Print parent-child structure of interactive items in a GLB."""
import struct, json, sys
from pathlib import Path

def parse(p):
    with open(p, 'rb') as f:
        f.read(12)
        while True:
            h = f.read(8)
            if len(h) < 8: break
            n = struct.unpack('<I', h[:4])[0]
            t = h[4:8]; d = f.read(n)
            if t == b'JSON':
                return json.loads(d.decode())

path = sys.argv[1] if len(sys.argv) > 1 else 'public/models/safe/r1.glb'
j = parse(path)
nodes = j.get('nodes', [])
names = [n.get('name', '') for n in nodes]

parent = {}
for i, n in enumerate(nodes):
    for ch in n.get('children', []):
        parent[ch] = i

interactive = ['room01_tv', 'calendar', 'room01_box', 'cellphone',
               'room01_fan', 'room01_pictureframe', 'room01_door']

print(f'=== {path} ===')
print(f'total nodes: {len(nodes)}')
print()
for name in interactive:
    if name not in names:
        print(f'{name}: NOT IN GLB')
        continue
    idx = names.index(name)
    n = nodes[idx]
    parent_idx = parent.get(idx, -1)
    parent_name = names[parent_idx] if parent_idx >= 0 else '(root)'
    children_names = [names[c] for c in n.get('children', [])]
    has_mesh = 'mesh' in n
    print(f'{name} [idx={idx}]')
    print(f'  parent: {parent_name}')
    print(f'  has_mesh attr: {has_mesh}')
    print(f'  children: {children_names[:8]}')

# now check: do leaf meshes climb up to interactive nodes?
print()
print('=== which leaf meshes resolve to interactive ancestor? ===')
hits = {n: 0 for n in interactive}
for i, n in enumerate(nodes):
    if 'mesh' not in n: continue
    cur = i
    chain = [names[i] or f'(idx{i})']
    while cur in parent:
        cur = parent[cur]
        chain.append(names[cur] or f'(idx{cur})')
    matched = [c for c in chain if c in interactive]
    if matched:
        hits[matched[0]] += 1
print('hits per interactive item:')
for k, v in hits.items():
    print(f'  {k}: {v}')
