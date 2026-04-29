"""compare GLB node names vs registered itemIds per room. dev-only diag."""
import struct, json, re
from pathlib import Path

text = Path('twr/data/events.ts').read_text()
items_per_room = {1: [], 2: [], 3: [], 4: [], 5: []}
for m in re.finditer(r"itemId:\s*'([^']+)',\s*\n?\s*room:\s*(\d)", text):
    items_per_room[int(m.group(2))].append(m.group(1))

def glb_parse(p):
    """returns (names_list, nodes_full, scene_roots) for ancestor walk emulation."""
    with open(p, 'rb') as f:
        f.read(12)
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            chunk_len = struct.unpack('<I', head[:4])[0]
            chunk_type = head[4:8]
            data = f.read(chunk_len)
            if chunk_type == b'JSON':
                j = json.loads(data.decode('utf-8'))
                nodes = j.get('nodes', [])
                names = [n.get('name', '') for n in nodes]
                # build parent map from children arrays
                parent = {}
                for idx, n in enumerate(nodes):
                    for ch in n.get('children', []):
                        parent[ch] = idx
                # leaf meshes: nodes that have a 'mesh' attribute
                leaves = [(idx, names[idx]) for idx, n in enumerate(nodes) if 'mesh' in n]
                return names, parent, leaves
    return [], {}, []

def glb_nodes(p):
    names, _, _ = glb_parse(p)
    return names

def ancestor_chain(idx, parent, names):
    chain = [names[idx]]
    while idx in parent:
        idx = parent[idx]
        chain.append(names[idx])
    return chain

for r in range(1, 6):
    p = Path(f'twr/public/models/room_0{r}.glb')
    if not p.exists():
        print(f'room {r}: GLB MISSING at {p}')
        continue
    names, parent, leaves = glb_parse(p)
    registered = set(items_per_room[r])
    print(f'\n=== ROOM {r} ===')
    print(f'  registered itemIds: {sorted(registered)}')
    print(f'  total nodes={len(names)}, leaf-meshes={len(leaves)}')
    # for each registered itemId — count how many leaf meshes have it in their ancestor chain
    for item in sorted(registered):
        # find node idx of this item
        idxs = [i for i, n in enumerate(names) if n == item]
        if not idxs:
            print(f'  ❌ {item}: NOT in GLB at all')
            continue
        # any leaf whose ancestor chain reaches this item idx
        target = set(idxs)
        clickable = 0
        for li, lname in leaves:
            cur = li
            while True:
                if cur in target:
                    clickable += 1
                    break
                if cur not in parent:
                    break
                cur = parent[cur]
        flag = '✅' if clickable > 0 else '⚠️ '
        print(f'  {flag} {item}: idx={idxs}, leaf-meshes-under-it={clickable}')
