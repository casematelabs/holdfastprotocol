"""
Fix 3 minor routine items (requires board-level auth).
Run: python3 scripts/fix-routine-minor-items.py
"""
import urllib.request, json, os, sys

API = os.environ.get("PAPERCLIP_API_URL", "http://localhost:3100")
KEY = os.environ.get("PAPERCLIP_API_KEY", "")

if not KEY:
    print("Set PAPERCLIP_API_KEY first:")
    print('  $env:PAPERCLIP_API_KEY = "your-board-token"')
    sys.exit(1)

def patch(url, data):
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="PATCH",
    )
    return json.loads(urllib.request.urlopen(req).read())

def delete(url):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {KEY}"}, method="DELETE",
    )
    urllib.request.urlopen(req)

print("1/3  Deleting duplicate trigger on Head of Growth partnership scan...")
try:
    delete(f"{API}/api/routine-triggers/e735c012-5b3f-4806-b751-65826d7e26ae")
    print("     OK — removed duplicate 'schedule-2' trigger")
except urllib.error.HTTPError as e:
    print(f"     FAIL ({e.code}): {e.read().decode()[:100]}")

CASEMATE_GOAL = "be2f218e-9cf7-40da-8945-64f226074bcc"

print("2/3  Setting goalId on Casemate Labs Website Coordination Sync...")
try:
    r = patch(f"{API}/api/routines/cfbe7780-fc66-42d1-b49b-14667edf6775", {"goalId": CASEMATE_GOAL})
    print(f"     OK — goal set")
except urllib.error.HTTPError as e:
    print(f"     FAIL ({e.code}): {e.read().decode()[:100]}")

print("3/3  Setting goalId on Video content production cycle...")
try:
    r = patch(f"{API}/api/routines/4fd86173-424d-413d-ad88-daaa4c2f9c33", {"goalId": CASEMATE_GOAL})
    print(f"     OK — goal set")
except urllib.error.HTTPError as e:
    print(f"     FAIL ({e.code}): {e.read().decode()[:100]}")

print("\nDone!")
