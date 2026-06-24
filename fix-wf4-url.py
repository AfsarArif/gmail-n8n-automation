#!/usr/bin/env python3
"""Fix WF-4 HTTP Request URL: localhost -> 127.0.0.1 (IPv6 compatibility on Fly)"""

import json, urllib.request, http.cookiejar

FLY = "https://angafsar.fly.dev"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

# Login
data = json.dumps({"emailOrLdapLoginId":"N8N_EMAIL_PLACEHOLDER","password":"N8N_PASSWORD_PLACEHOLDER"}).encode()
opener.open(urllib.request.Request(f"{FLY}/rest/login", data=data, headers={"Content-Type":"application/json"}))
print("1. Logged in")

# Fetch WF-4
resp = json.loads(opener.open(f"{FLY}/rest/workflows/RYXfQYtii4ZheW6e").read())
wf = resp["data"]
print(f"2. Fetched WF-4: {wf['name']}")

# Fix the URL
fixed = False
for n in wf["nodes"]:
    url = n.get("parameters", {}).get("url", "")
    if "classify-email-v2" in url:
        print(f"   Current URL: {url}")
        n["parameters"]["url"] = "http://127.0.0.1:5678/webhook/classify-email-v2"
        print(f"   Fixed to:    {n['parameters']['url']}")
        fixed = True
        break

if not fixed:
    print("   URL not found — may already be fixed")
    import sys; sys.exit(0)

# Try PATCH
body = json.dumps({"data": wf}).encode()
req = urllib.request.Request(f"{FLY}/rest/workflows/RYXfQYtii4ZheW6e", data=body,
    headers={"Content-Type":"application/json"}, method="PATCH")
resp2 = json.loads(opener.open(req).read())
patched = resp2["data"]
print(f"3. PATCH returned versionId={patched['versionId']}")

# Re-fetch to verify
resp3 = json.loads(opener.open(f"{FLY}/rest/workflows/RYXfQYtii4ZheW6e").read())
recheck = resp3["data"]
for n in recheck["nodes"]:
    url = n.get("parameters", {}).get("url", "")
    if "classify-email-v2" in url:
        if "127.0.0.1" in url:
            print(f"4. ✅ VERIFIED: URL is now {url}")
        else:
            print(f"4. ❌ PATCH DID NOT STICK: URL is still {url}")
            print("   Will use delete+re-import approach instead...")

            # Delete + reimport approach
            # 1. Fix the export file
            with open("/Users/afsararif/Documents/Projects/gmailn8n/exports/export-RYXfQYtii4ZheW6e.json") as f:
                export_wf = json.load(f)

            for en in export_wf["nodes"]:
                if "classify-email-v2" in en.get("parameters", {}).get("url", ""):
                    en["parameters"]["url"] = "http://127.0.0.1:5678/webhook/classify-email-v2"

            export_wf.pop("id", None)
            export_wf.pop("createdAt", None)
            export_wf.pop("updatedAt", None)
            export_wf.pop("versionId", None)
            export_wf["active"] = False

            # 2. Import as new
            body2 = json.dumps(export_wf).encode()
            req2 = urllib.request.Request(f"{FLY}/rest/workflows", data=body2,
                headers={"Content-Type":"application/json"}, method="POST")
            resp_import = json.loads(opener.open(req2).read())
            new_id = resp_import["data"]["id"]
            new_vid = resp_import["data"]["versionId"]
            print(f"   Imported as: {new_id}")

            # 3. Activate
            act = json.dumps({"versionId": new_vid}).encode()
            req3 = urllib.request.Request(f"{FLY}/rest/workflows/{new_id}/activate", data=act,
                headers={"Content-Type":"application/json"}, method="POST")
            resp_act = json.loads(opener.open(req3).read())
            print(f"   Activated: {resp_act['data']['active']}")

            # 4. Deactivate old WF-4
            old_vid = patched["versionId"]
            deact = json.dumps({"versionId": old_vid}).encode()
            try:
                req4 = urllib.request.Request(f"{FLY}/rest/workflows/RYXfQYtii4ZheW6e/deactivate", data=deact,
                    headers={"Content-Type":"application/json"}, method="POST")
                opener.open(req4)
                print(f"   Deactivated old WF-4 (RYXfQYtii4ZheW6e)")
            except Exception as e:
                print(f"   Deactivate note: {e}")

            print(f"\n   ⚠️  NEW WF-4 ID: {new_id}")
            print(f"   ⚠️  Update finish-deploy.sh and any webhook URL references!")
            print(f"   ⚠️  New webhook URL: {FLY}/webhook/start-cleanup (same path, new ID)")

# Run E2E test
print("\n5. Running E2E test...")
try:
    req5 = urllib.request.Request(f"{FLY}/webhook/start-cleanup",
        data=b'{}', headers={
            "Content-Type": "application/json",
            "x-webhook-token": "WEBHOOK_TOKEN_PLACEHOLDER"
        }, method="POST")
    resp5 = json.loads(opener.open(req5).read())
    print(f"   Result: {json.dumps(resp5, indent=2)}")
except Exception as e:
    print(f"   E2E test failed: {e}")
