# Bulk upload เพลง+รูปวงขึ้น R2 ผ่าน /api/media ของ Worker
import os, sys, json, ssl, urllib.request, urllib.parse

# แก้ SSL ไม่มี root CA ใน Windows Python (ข้าม verify เฉพาะการอัปเหม็ดของเราเอง)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "https://site-8429d94d492f40cf8cc012ca4b25ac79.freebuff.page"
TOKEN = open("media_token_secret.txt", encoding="utf-8").read().strip()
extmap = {".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".webp": "image/webp"}

roots = ["indy", "pop", "r&b"]
files = []
for root in roots:
    for dirpath, _, names in os.walk(root):
        for n in names:
            if os.path.splitext(n)[1].lower() in extmap:
                files.append(os.path.join(dirpath, n))

ok = fail = 0
for f in files:
    ext = os.path.splitext(f)[1].lower()
    ctype = extmap[ext]
    key = urllib.parse.quote(f.replace("\\", "/"), safe="/")
    url = f"{BASE}/api/media/{key}"
    req = urllib.request.Request(url, data=open(f, "rb").read(), method="POST",
        headers={"x-media-token": TOKEN, "content-type": ctype,
                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as r:
            if r.status == 200:
                ok += 1
            else:
                fail += 1
                print("FAIL", r.status, f)
    except Exception as e:
        fail += 1
        print("FAIL", f, e)

print(f"uploaded={ok} failed={fail} total={len(files)}")
