"""diag: count narrative_logs per (session_id, room), and dump last 30 rows."""
import os, sys
from supabase import create_client

URL    = os.environ.get('NEXT_PUBLIC_SUPABASE_URL') or os.environ['SUPABASE_URL']
SECRET = os.environ['SUPABASE_SECRET_KEY']
sup = create_client(URL, SECRET)

# 1) Distinct sessions with their per-room counts (last 24h)
res = sup.from_('narrative_logs').select(
    'session_id, room, item_id, event_index, choice_index, played_at'
).order('played_at', desc=True).limit(200).execute()
rows = res.data or []
print(f'\nfetched {len(rows)} most recent rows\n')

from collections import defaultdict
by_session = defaultdict(lambda: defaultdict(int))
order = []
for r in rows:
    sid = r['session_id']
    if sid not in by_session:
        order.append(sid)
    by_session[sid][r['room']] += 1

print('=== per-session room coverage (most recent 5 sessions) ===')
for sid in order[:5]:
    counts = by_session[sid]
    cov = ' '.join(f'R{k}={v}' for k, v in sorted(counts.items()))
    print(f'  {sid[:8]}…  {cov}')

print('\n=== latest 30 rows ===')
for r in rows[:30]:
    print(f"  {r['played_at'][11:19]}  R{r['room']}  {r['item_id'][:30]:30}  ev{r['event_index']} ci{r['choice_index']}")
