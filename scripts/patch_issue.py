import json, os, urllib.request, sys

comment = sys.stdin.read().strip()
issue_id = os.environ.get("PAPERCLIP_TASK_ID", "")
api_url = os.environ.get("PAPERCLIP_API_URL", "http://127.0.0.1:3100")
api_key = os.environ.get("PAPERCLIP_API_KEY", "")
run_id = os.environ.get("PAPERCLIP_RUN_ID", "patch-script")

if not issue_id:
    print("Error: PAPERCLIP_TASK_ID not set")
    sys.exit(1)

payload = json.dumps({
    "status": "cancelled",
    "comment": comment
}, ensure_ascii=False).replace("\x00", "")

req = urllib.request.Request(
    f"{api_url}/api/issues/{issue_id}",
    data=payload.encode("utf-8"),
    headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json; charset=utf-8",
        "X-Paperclip-Run-Id": run_id,
    },
    method="PATCH",
)
try:
    with urllib.request.urlopen(req) as resp:
        print(f"Status: {resp.status}")
        print(resp.read().decode())
except urllib.error.HTTPError as e:
    print(f"HTTP Error: {e.code}")
    print(e.read().decode())
    sys.exit(1)
