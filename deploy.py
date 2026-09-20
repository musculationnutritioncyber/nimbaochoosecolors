#!/usr/bin/env python3
"""Déploie nimbao-color-vote sur Vercel, sans Node ni CLI.

usage: python3 deploy.py [--preview]

Les fichiers sont envoyés un par un (POST /v2/files, dédoublonnés par sha1) puis
référencés dans le déploiement : les ~8 Mo d'images ne passent pas en un seul JSON.
Le projet Vercel `nimbao-color-vote` doit déjà exister, avec un store Blob connecté
(BLOB_READ_WRITE_TOKEN) et la variable ADMIN_PIN.
"""
import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
TEAM_ID = "team_VFfWZfWvmyvGsRZVflQy0ny4"
PROJECT = "nimbao-color-vote"
TOKEN = (pathlib.Path.home() / ".config/vercel/token").read_text().strip()
INCLUDE_SUFFIXES = {".js", ".html", ".css", ".json", ".webp", ".png"}
SKIP_DIRS = {"node_modules", ".git", ".vercel"}


def call(method, url, data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers={
        "Authorization": f"Bearer {TOKEN}", **(headers or {})})
    try:
        return json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} sur {url.split('?')[0]} : {e.read().decode()[:600]}")


def main():
    preview = "--preview" in sys.argv
    files = []
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT)
        if not p.is_file() or p.suffix not in INCLUDE_SUFFIXES or any(d in SKIP_DIRS for d in rel.parts):
            continue
        raw = p.read_bytes()
        sha = hashlib.sha1(raw).hexdigest()
        call("POST", f"https://api.vercel.com/v2/files?teamId={TEAM_ID}", raw, {
            "Content-Type": "application/octet-stream", "x-vercel-digest": sha, "Content-Length": str(len(raw))})
        files.append({"file": rel.as_posix(), "sha": sha, "size": len(raw)})
    print(f"{len(files)} fichiers, {sum(f['size'] for f in files) // 1024} Ko -> {'preview' if preview else 'production'}")

    created = call("POST", f"https://api.vercel.com/v13/deployments?teamId={TEAM_ID}&skipAutoDetectionConfirmation=1",
                   json.dumps({"name": PROJECT, "project": PROJECT, **({} if preview else {"target": "production"}),
                               "files": files, "projectSettings": {"framework": None}}).encode(),
                   {"Content-Type": "application/json"})
    dep_id, url = created["id"], created["url"]
    print(f"déploiement {dep_id}\nhttps://{url}")
    t0 = time.time()
    while time.time() - t0 < 600:
        time.sleep(5)
        state = call("GET", f"https://api.vercel.com/v13/deployments/{dep_id}?teamId={TEAM_ID}")["readyState"]
        print(" ", state, flush=True)
        if state == "READY":
            print(f"\nOK -> https://{url}")
            return
        if state in ("ERROR", "CANCELED"):
            sys.exit(f"échec du déploiement : {state}")
    sys.exit("TIMEOUT")


if __name__ == "__main__":
    main()
