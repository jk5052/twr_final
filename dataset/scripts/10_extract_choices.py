"""
Parse twr/data/events.ts → flat list of player choices for Stream-B labeling.
Output: twr/dataset/processed/choices_raw.json

Each choice carries enough context for downstream tagging:
  source        : 'ITEMS' | 'ROOM_ENTRY_EVENTS'
  room          : 1..5
  item_id       : itemId (or 'room_entry' for ROOM_ENTRY_EVENTS)
  event_index   : index inside that item's events array
  choice_index  : index inside the event's choices array
  prompt        : event.text (single string, joined if multi-line)
  label         : choice label (the text the player clicks)
  tag           : 5-tag UX label (AV|EX|CG|SP|AD)
  end_chain     : choice.endChain
  card_id       : choice.cardId (or null)
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
EVENTS_TS = REPO_ROOT / 'twr' / 'data' / 'events.ts'
OUT_PATH  = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'choices_raw.json'

src = EVENTS_TS.read_text(encoding='utf-8')


def _strip(s: str) -> str:
    """Strip surrounding quotes (', ", `) from a TS string literal segment."""
    s = s.strip()
    if s and s[0] in "'\"`" and s[-1] == s[0]:
        return s[1:-1]
    return s


_ESCAPES = {"\\'": "'", '\\"': '"', '\\`': '`', '\\\\': '\\',
            '\\n': '\n', '\\t': '\t', '\\r': '\r'}


def _unescape(s: str) -> str:
    """Resolve TS string-literal escapes without touching valid UTF-8 bytes."""
    out, i, n = [], 0, len(s)
    while i < n:
        if s[i] == '\\' and i + 1 < n:
            two = s[i:i + 2]
            if two in _ESCAPES:
                out.append(_ESCAPES[two])
                i += 2
                continue
            if two == '\\u' and i + 6 <= n:
                try:
                    out.append(chr(int(s[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            out.append(s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return ''.join(out)


def _join_concat(text_expr: str) -> str:
    """Join 'a' + 'b' + 'c' style TS concatenations into one string."""
    parts = re.findall(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", text_expr)
    pieces = [a or b or c for a, b, c in parts]
    return _unescape(''.join(pieces))


# Find every event block:  text: <expr>, choices: [ ... ]
# We split events by their `text:` opener and walk balanced brackets to capture choices.
def find_balanced(s: str, start: int, open_ch: str, close_ch: str) -> int:
    depth = 0
    in_str = None
    i = start
    while i < len(s):
        ch = s[i]
        if in_str:
            if ch == '\\' and i + 1 < len(s):
                i += 2
                continue
            if ch == in_str:
                in_str = None
        else:
            if ch in "'\"`":
                in_str = ch
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def _itemid_room_for_offset(off: int) -> tuple[str, int, str]:
    """Find the most recent itemId / ROOM_ENTRY_EVENTS room context before offset."""
    head = src[:off]
    item_match = None
    for m in re.finditer(r"itemId:\s*'([^']+)'\s*,\s*\n\s*room:\s*(\d+)", head):
        item_match = m
    rer_match = None
    for m in re.finditer(r"ROOM_ENTRY_EVENTS\s*:\s*Record<number,\s*ObjectEvent\[\]>\s*=\s*\{", head):
        rer_match = m
    rer_room = None
    if rer_match and (not item_match or rer_match.start() > item_match.end()):
        for m in re.finditer(r'^\s{2}(\d+):\s*\[', head, flags=re.MULTILINE):
            if m.start() > rer_match.end():
                rer_room = int(m.group(1))
    if rer_room is not None:
        return ('ROOM_ENTRY_EVENTS', rer_room, 'room_entry')
    if item_match:
        return ('ITEMS', int(item_match.group(2)), item_match.group(1))
    return ('?', 0, '?')


choices_out: list[dict] = []
event_idx_per_item: dict[tuple[str, int, str], int] = {}

for ev in re.finditer(r'text:\s*', src):
    # parse `text:` value (may be string or multi-line concatenation up to `,\n  choices:`)
    after = ev.end()
    ch_off = src.find('choices:', after)
    if ch_off < 0:
        continue
    text_expr = src[after:ch_off].rstrip().rstrip(',').rstrip()
    prompt = _join_concat(text_expr)
    if not prompt:
        continue

    # parse choices array
    bracket = src.find('[', ch_off)
    end = find_balanced(src, bracket, '[', ']')
    if end < 0:
        continue
    arr = src[bracket + 1:end]

    # split top-level objects
    objs: list[str] = []
    i = 0
    while i < len(arr):
        if arr[i] == '{':
            j = find_balanced(arr, i, '{', '}')
            if j < 0:
                break
            objs.append(arr[i:j + 1])
            i = j + 1
        else:
            i += 1

    src_kind, room, item_id = _itemid_room_for_offset(ev.start())
    key = (src_kind, room, item_id)
    event_index = event_idx_per_item.get(key, 0)
    event_idx_per_item[key] = event_index + 1

    for ci, obj in enumerate(objs):
        m_label = re.search(
            r"label:\s*((?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`)(?:\s*\+\s*(?:'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`))*)",
            obj)
        m_tag   = re.search(r"tag:\s*'([^']+)'", obj)
        if not (m_label and m_tag):
            continue
        m_end   = re.search(r'endChain:\s*(true|false)', obj)
        m_card  = re.search(r"cardId:\s*'([^']+)'", obj)
        choices_out.append({
            'source'      : src_kind,
            'room'        : room,
            'item_id'     : item_id,
            'event_index' : event_index,
            'choice_index': ci,
            'prompt'      : prompt,
            'label'       : _join_concat(m_label.group(1)),
            'tag'         : m_tag.group(1),
            'end_chain'   : m_end.group(1) == 'true' if m_end else False,
            'card_id'     : m_card.group(1) if m_card else None,
        })

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(json.dumps(choices_out, indent=2, ensure_ascii=False), encoding='utf-8')

from collections import Counter
by_room   = Counter(c['room'] for c in choices_out)
by_source = Counter(c['source'] for c in choices_out)
by_tag    = Counter(c['tag'] for c in choices_out)
print(f'extracted: {len(choices_out)} choices  → {OUT_PATH}')
print(f'by source : {dict(by_source)}')
print(f'by room   : {dict(sorted(by_room.items()))}')
print(f'by tag    : {dict(by_tag.most_common())}')
