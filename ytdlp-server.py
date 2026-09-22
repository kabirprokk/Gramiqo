#!/usr/bin/env python3
"""Gramiqo local yt-dlp bridge (optional, one-click protected downloads).

Why this exists: a Chrome MV3 extension CANNOT run yt-dlp itself
(no subprocess, no binaries). So the flow is:

  Extension --POST {url, filename}--> http://127.0.0.1:8765/gramiqo
  This server --runs--> yt-dlp --cookies-from-browser chrome <url>

Setup (2 minutes):
  1. pip install yt-dlp        (or: winget install yt-dlp)
  2. python ytdlp-server.py    (keep it running; localhost only)
  3. In Instagram, click Download again — protected videos now save
     instantly with zero copy-paste. If the server is NOT running, the
     extension silently falls back to "Copy yt-dlp command".

Security: binds 127.0.0.1 only, no CORS wildcard abuse, filename is
sanitized, subprocess has no shell=True.
"""
import http.server
import json
import os
import re
import shutil
import subprocess
import urllib.parse

HOST = "127.0.0.1"
PORT = 8765
DOWNLOADS = os.path.join(os.path.expanduser("~"), "Downloads", "Gramiqo")

SAFE = re.compile(r"[^A-Za-z0-9._-]+").sub


def safe_filename(name: str, default="gramiqo-%(id)s.%(ext)s"):
    name = (name or "").strip() or default
    name = os.path.basename(name)
    name = SAFE("-", name)[:120]
    if not re.search(r"\.[a-z0-9]{2,5}$", name, re.I):
        name += ".mp4"
    return name


def valid_ig_url(url: str) -> bool:
    try:
        p = urllib.parse.urlparse(url)
        if p.scheme not in ("http", "https"):
            return False
        host = (p.netloc or "").lower()
        return host == "instagram.com" or host.endswith(".instagram.com")
    except Exception:
        return False


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "GramiqoBridge/1.0"

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "https://www.instagram.com")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/", "/gramiqo", "/health"):
            return self._json(200, {"ok": True, "service": "gramiqo-yt-dlp-bridge"})
        return self._json(404, {"ok": False})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/gramiqo", "/"):
            return self._json(404, {"ok": False})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except Exception:
            length = 0
        if length <= 0 or length > 4096:
            return self._json(400, {"ok": False, "error": "bad-body"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8", "ignore"))
        except Exception:
            return self._json(400, {"ok": False, "error": "bad-json"})
        url = str(payload.get("url") or "")
        if not valid_ig_url(url):
            return self._json(400, {"ok": False, "error": "bad-url"})
        fname = safe_filename(str(payload.get("filename") or ""))
        os.makedirs(DOWNLOADS, exist_ok=True)
        out = os.path.join(DOWNLOADS, fname)
        ytdlp = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
        if not ytdlp:
            return self._json(200, {"ok": False, "saved": False,
                                    "error": "yt-dlp not on PATH (pip install yt-dlp)"})
        # Cookies from YOUR Chrome session handle login-gated/private posts.
        cmds = [
            [ytdlp, "--cookies-from-browser", "chrome", "--no-playlist",
             "-o", out, url],
            [ytdlp, "--no-playlist", "-o", out, url],  # fallback: public posts
        ]
        last_err = ""
        for cmd in cmds:
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if proc.returncode == 0 and os.path.exists(out):
                    return self._json(200, {"ok": True, "saved": True, "file": out})
                last_err = (proc.stderr or proc.stdout or "")[-300:]
            except subprocess.TimeoutExpired:
                last_err = "yt-dlp timed out"
            except Exception as e:  # noqa: BLE001
                last_err = str(e)[:200]
        return self._json(200, {"ok": False, "saved": False, "error": last_err or "download failed"})


if __name__ == "__main__":
    os.makedirs(DOWNLOADS, exist_ok=True)
    print(f"Gramiqo yt-dlp bridge on http://{HOST}:{PORT}/gramiqo")
    print(f"Saving to: {DOWNLOADS}")
    print("Keep this running, then use Download in Instagram.")
    http.server.HTTPServer((HOST, PORT), Handler).serve_forever()
