"""
Prune seed_letters: keep 37 reviewed IDs, drop 47.

- input : twr/dataset/processed/seed_letters.json (84 entries)
- output: same file rewritten with only the 37 kept entries
- side  : delete the 47 dropped (primary_defense, blank_answer) rows
          from public.seed_letters (source='seed') in Supabase.

Re-runnable: if JSON already pruned, prints 'already pruned' and only
performs DB cleanup (idempotent — missing rows are no-ops).

Env (loaded from repo .env):
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
"""
import json
import os
from pathlib import Path
from collections import Counter
from supabase import create_client
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / '.env')

SUPABASE_URL        = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY')
assert SUPABASE_URL and SUPABASE_SECRET_KEY, 'Supabase env missing'
sup = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)

DATA_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'seed_letters.json'
BACKUP_PATH = REPO_ROOT / 'twr' / 'dataset' / 'processed' / 'seed_letters.full84.bak.json'

KEEP_IDS = {
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    12, 14, 16,
    22, 24, 27, 28,
    32, 34, 36, 38,
    41, 44, 48, 50,
    53, 56, 58, 60, 61,
    66, 68,
    71, 75, 78,
    81, 83,
}
assert len(KEEP_IDS) == 37, f'expected 37 keep IDs, got {len(KEEP_IDS)}'


def main() -> None:
    raw = json.loads(DATA_PATH.read_text(encoding='utf-8'))
    print(f'Loaded {len(raw)} entries from {DATA_PATH.name}')

    if len(raw) == 37:
        existing_ids = {r['id'] for r in raw}
        if existing_ids == KEEP_IDS:
            print('JSON already pruned to 37 keep IDs (skipping rewrite)')
            keep = raw
            drop = []
        else:
            raise SystemExit(f'JSON has 37 entries but IDs differ: {existing_ids ^ KEEP_IDS}')
    else:
        keep = [r for r in raw if r['id'] in KEEP_IDS]
        drop = [r for r in raw if r['id'] not in KEEP_IDS]
        if len(keep) != 37:
            raise SystemExit(f'expected 37 kept, got {len(keep)} — JSON missing some keep IDs?')

        # backup full 84 once
        if not BACKUP_PATH.exists():
            BACKUP_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2),
                                   encoding='utf-8')
            print(f'Backup written: {BACKUP_PATH.name}')

        # rewrite filtered JSON
        DATA_PATH.write_text(json.dumps(keep, ensure_ascii=False, indent=2),
                             encoding='utf-8')
        print(f'Rewrote {DATA_PATH.name} with {len(keep)} entries '
              f'(dropped {len(drop)})')

    # defense coverage check
    defenses = Counter(r['primary_defense'] for r in keep)
    print(f'\nDefense coverage (kept set):  {len(defenses)} unique')
    missing = []
    for name, n in sorted(defenses.items()):
        print(f'  {name:30s} {n}')
    if len(defenses) != 28:
        print(f'  ! coverage is {len(defenses)}/28 — verify manually')
    print()

    # DB cleanup: delete dropped (defense, answer) pairs
    if drop:
        print(f'Deleting {len(drop)} dropped rows from public.seed_letters …')
        deleted = 0
        failed = 0
        for r in drop:
            defense = (r.get('primary_defense') or '').strip()
            answer  = (r.get('blank_answer') or '').strip()
            try:
                resp = (sup.table('seed_letters')
                        .delete()
                        .eq('source', 'seed')
                        .eq('primary_defense', defense)
                        .eq('blank_answer', answer)
                        .execute())
                n = len(resp.data or [])
                if n:
                    deleted += n
                    print(f'  - id={r["id"]:>2}  {defense} / "{answer}"  ({n} row)')
                else:
                    print(f'  · id={r["id"]:>2}  not in DB (already pruned)')
            except Exception as e:
                failed += 1
                print(f'  ! id={r["id"]} delete failed: {type(e).__name__}: {str(e)[:120]}')
        print(f'\nDB delete done.  deleted={deleted}, failed={failed}')
    else:
        # idempotent path: also sweep DB so it matches keep set
        print('Sweeping DB to ensure only 37 kept rows remain (source=seed) …')
        keep_pairs = {(r['primary_defense'], r['blank_answer']) for r in keep}
        resp = (sup.table('seed_letters')
                .select('id, primary_defense, blank_answer')
                .eq('source', 'seed')
                .limit(2000)
                .execute())
        rows = resp.data or []
        stale = [row for row in rows
                 if (row['primary_defense'], row['blank_answer']) not in keep_pairs]
        for row in stale:
            sup.table('seed_letters').delete().eq('id', row['id']).execute()
            print(f'  - removed stale  {row["primary_defense"]} / "{row["blank_answer"]}"')
        print(f'Sweep done. removed_stale={len(stale)}, in_db_now={len(rows) - len(stale)}')


if __name__ == '__main__':
    main()
