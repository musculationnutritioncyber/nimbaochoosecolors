#!/usr/bin/env python3
"""Serveur local de démonstration : sert le site ET imite les 3 routes /api de Vercel,
avec les votes dans _local/ (fichiers JSON). Sert à voir l'admin avant la mise en ligne.
PIN local : 0000.   usage: python3 dev_server.py [port]
"""
import base64, http.server, json, pathlib, re, sys, time

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT / "_local"; (DATA / "img").mkdir(parents=True, exist_ok=True)
PIN = "0000"


def load(name, default):
    p = DATA / name
    return json.loads(p.read_text()) if p.exists() else default


def save(name, value):
    (DATA / name).write_text(json.dumps(value))


def deck():
    base = json.loads((ROOT / "deck.json").read_text())
    cfg = load("config.json", None)
    if cfg: base["colors"] = cfg
    return base


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def log_message(self, *a): pass

    def send(self, code, obj):
        raw = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/admin": self.path = "/admin.html"
        if path == "/api/deck":
            d = deck()
            return self.send(200, {"product": d["product"], "perVoter": d["perVoter"],
                                   "colors": [c for c in d["colors"] if c["active"]]})
        if path == "/api/admin":
            if self.headers.get("x-admin-pin") != PIN: return self.send(401, {"error": "wrong PIN"})
            d, votes = deck(), load("votes.json", {})
            tally = {}
            for s in votes.values():
                for cid, v in s["votes"].items():
                    t = tally.setdefault(cid, {"l": 0, "d": 0, "f": 0}); t["l" if v else "d"] += 1
                if s.get("fav"): tally.setdefault(s["fav"], {"l": 0, "d": 0, "f": 0})["f"] += 1
            return self.send(200, {
                "product": d["product"], "perVoter": d["perVoter"], "pending": 0, "voters": len(votes),
                "completed": sum(1 for s in votes.values() if s.get("done")),
                "swipes": sum(len(s["votes"]) for s in votes.values()),
                "lastVote": max([s.get("t", 0) for s in votes.values()] or [0]),
                "colors": [{**c, **tally.get(c["id"], {"l": 0, "d": 0, "f": 0})} for c in d["colors"]]})
        return super().do_GET()

    def do_POST(self):
        path, b = self.path.split("?")[0], self.body()
        if path == "/api/vote":
            if b.get("src") == "test": return self.send(200, {"ok": True})
            votes = load("votes.json", {})
            s = votes.setdefault(b["sid"], {"votes": {}})
            for v in b.get("votes", []): s["votes"].setdefault(v["id"], 1 if v["v"] else 0)
            if b.get("fav"): s.setdefault("fav", b["fav"])
            if b.get("done"): s["done"] = 1
            s["t"] = int(time.time() * 1000); save("votes.json", votes)
            return self.send(200, {"ok": True})
        if path == "/api/admin":
            if self.headers.get("x-admin-pin") != PIN: return self.send(401, {"error": "wrong PIN"})
            colors = deck()["colors"]
            if b.get("action") == "active":
                for c in colors:
                    if c["id"] in b["ids"]: c["active"] = bool(b["active"])
            elif b.get("action") == "add":
                m = re.match(r"data:image/(webp|jpeg);base64,(.+)", b.get("dataUrl", ""))
                if not m or not b.get("name"): return self.send(400, {"error": "bad photo"})
                cid = "u" + str(int(time.time()))
                (DATA / "img" / f"{cid}.jpg").write_bytes(base64.b64decode(m.group(2)))
                colors.insert(0, {"id": cid, "name": b["name"][:40], "active": True, "img": f"/_local/img/{cid}.jpg"})
            else: return self.send(400, {"error": "unknown action"})
            save("config.json", colors); return self.send(200, {"ok": True})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
    http.server.ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
