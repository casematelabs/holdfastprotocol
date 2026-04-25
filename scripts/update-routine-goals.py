"""
Update goalIds on 12 Holdfast Protocol routines.
Run from PowerShell: python3 scripts/update-routine-goals.py

Requires PAPERCLIP_API_KEY with board-level auth and PAPERCLIP_API_URL set.
If not set, defaults to http://localhost:3100.
"""
import urllib.request, json, os, sys

API = os.environ.get("PAPERCLIP_API_URL", "http://localhost:3100")
KEY = os.environ.get("PAPERCLIP_API_KEY", "")

if not KEY:
    print("ERROR: PAPERCLIP_API_KEY not set. Export it first:")
    print('  $env:PAPERCLIP_API_KEY = "your-board-token"')
    sys.exit(1)

UPDATES = [
    # (routine_id, title, goal_id)
    # Holdfast Protocol devnet deployment
    ("7b9a84e9-76cc-42bb-81b2-1bc44d9de7a2", "CTO technical review", "acb7fbcf-f65d-4a99-b4ac-a711ccd04fa7"),
    ("bf3edaf8-edbb-45b8-a085-4fab73110996", "SC Eng build cycle", "acb7fbcf-f65d-4a99-b4ac-a711ccd04fa7"),
    ("09bc37ef-72d3-4fb3-b4b5-8f1d53eeb5c6", "SC Eng deep build", "acb7fbcf-f65d-4a99-b4ac-a711ccd04fa7"),
    ("906cadee-bc6c-40e2-95c7-a8954464135a", "Backend Eng implementation", "acb7fbcf-f65d-4a99-b4ac-a711ccd04fa7"),
    ("1aa972af-836a-4730-9cd7-311736d4a685", "PM coordination sync", "acb7fbcf-f65d-4a99-b4ac-a711ccd04fa7"),
    # Holdfast Protocol mainnet beta
    ("1762fba8-6533-4753-a9e6-186171b067c9", "Head of Product roadmap sync", "785e223e-3e09-453e-8208-84d813d64a43"),
    # Security audit readiness
    ("5e40d244-72e8-4156-8e6f-8495aaa6a9f3", "QA test coverage review", "12351950-9c84-41f1-ba00-51360e44c990"),
    ("3b72a6df-7b0e-4e4a-afe4-31cd8dfa39ca", "Head of Security audit tracker", "12351950-9c84-41f1-ba00-51360e44c990"),
    ("e9621722-4488-44d1-8ae8-bc3a657f177f", "Head of Security deep audit", "12351950-9c84-41f1-ba00-51360e44c990"),
    # SDK docs and integration guide v1
    ("cce08b6b-0323-4a27-b970-9c8dc0ec0a73", "DevRel developer advocacy", "1d3f1d14-4316-40e5-9234-a095b4fdcee5"),
    # Dashboard UI v1
    ("71086862-dc23-4a93-98aa-55c89becce9a", "UI/UX Designer design review", "9d111f34-3f04-4f0d-920d-fa5fd1e2a6f3"),
    # First protocol revenue
    ("57d7a94d-9b05-4040-a98d-805d554b9f94", "Head of Growth partnership scan", "c27d81a8-cf8a-43fa-84fc-aabed2f7caff"),
]

ok = 0
fail = 0
for rid, title, gid in UPDATES:
    data = json.dumps({"goalId": gid}).encode()
    req = urllib.request.Request(
        f"{API}/api/routines/{rid}",
        data=data,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="PATCH",
    )
    try:
        resp = json.loads(urllib.request.urlopen(req).read())
        print(f"  OK  {title}")
        ok += 1
    except urllib.error.HTTPError as e:
        print(f"FAIL  {title} ({e.code}: {e.read().decode()[:100]})")
        fail += 1

print(f"\nDone: {ok} updated, {fail} failed")
