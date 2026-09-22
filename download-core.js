/* ============================================================
   Gramiqo - download-core.js (shared resolver + yt-dlp bridge)
   Loaded AFTER icons.js, BEFORE content.js/search.js/power.js.
   Purpose: turn "protected stream" blob:/DASH cases into real .mp4s
   the same way yt-dlp does first — Instagram's own progressive
   video_url (embed + ?__a=1 JSON) — then fall back to an honest
   yt-dlp handoff (local bridge or copy-paste command).
   No throw, no dependency, CSP-safe. Everything degrades gracefully
   if a single source is blocked.
   ============================================================ */
(() => {
"use strict";

const IG_APP_ID = "936619743392459";
const BRIDGE_URL = "http://127.0.0.1:8765/gramiqo";
// Hidden downloader page: unlisted, noindex, opened ONLY mid-download.
// Extension sends ?url=&auto=1&mid=&fn= → page auto-fetches + auto-saves.
const SITE_BASE = "https://gramiqo.vercel.app/d.html";

function shortcodeFromUrl(u) {
  try {
    const s = String(u || "");
    const m = s.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    return m ? m[1] : "";
  } catch { return ""; }
}

function pageShortcode() {
  try {
    return shortcodeFromUrl(location.href);
  } catch { return ""; }
}

function pageUrlForShortcode(code) {
  try {
    if (!code) return location.href;
    return "https://www.instagram.com/reel/" + code + "/";
  } catch { return location.href; }
}

function ytdlpCommand(pageUrl, filename) {
  const url = String(pageUrl || location.href);
  const out = String(filename || "gramiqo-%(id)s.%(ext)s").replace(/"/g, "");
  // --cookies-from-browser reads YOUR logged-in Chrome session, so private/
  // login-gated posts work the same as in the tab. Brave/Edge users: change
  // "chrome" to "brave"/"edge".
  return `yt-dlp --cookies-from-browser chrome --no-playlist -o "${out}" "${url}"`;
}

function toastLocal(msg) {
  try {
    if (typeof window.GramiqoToast === "function") return window.GramiqoToast(msg);
  } catch {}
  try {
    let el = document.getElementById("inta-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "inta-toast";
      try {
        el.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;z-index:1000000;max-width:90vw;text-align:center;font-family:sans-serif;";
      } catch {}
      document.documentElement.appendChild(el);
    }
    el.textContent = String(msg);
    try { el.style.opacity = "1"; } catch {}
    clearTimeout(el._t);
    el._t = setTimeout(() => { try { el.style.opacity = "0"; } catch {} }, 2400);
  } catch {}
}

function copyTextRaw(text, okMsg) {
  const done = () => toastLocal(okMsg || "Copied!");
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(String(text)).then(done, () => legacyCopy(String(text), okMsg));
      return;
    }
  } catch {}
  legacyCopy(String(text), okMsg);
}
function legacyCopy(text, okMsg) {
  try {
    const ta = document.createElement("textarea");
    ta.value = String(text);
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toastLocal(ok ? (okMsg || "Copied!") : "Copy failed — select manually");
  } catch {
    toastLocal("Copy failed — select manually");
  }
}

// Deep-scan any JSON for the biggest progressive video URL.
// Prefers video_url / video_versions sorted by width — same ranking yt-dlp uses.
function deepScanVideoUrl(root) {
  let best = "";
  let bestW = -1;
  try {
    const stack = [root];
    let steps = 0;
    while (stack.length && steps < 3000) {
      steps += 1;
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (Array.isArray(cur)) {
        for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
        continue;
      }
      try {
        const vv = cur.video_versions;
        if (Array.isArray(vv)) {
          for (const v of vv) {
            const u = v?.url;
            const w = Number(v?.width) || 0;
            if (typeof u === "string" && /^https?:\/\//.test(u) && w >= bestW) {
              bestW = w;
              best = u;
            }
          }
        }
      } catch {}
      try {
        const vu = cur.video_url;
        if (typeof vu === "string" && /^https?:\/\//.test(vu) && bestW < 720) {
          bestW = 720;
          best = vu;
        }
      } catch {}
      for (const k of Object.keys(cur)) {
        try {
          const v = cur[k];
          if (v && typeof v === "object") stack.push(v);
        } catch {}
      }
    }
  } catch {}
  return best;
}

function cleanMp4(u) {
  try {
    let s = String(u || "").replace(/\\u0026/gi, "&").replace(/\\&/g, "&").replace(/\\/g, "");
    const m = s.match(/https?:\/\/[^"'\s<>]+?\.mp4[^"'\s<>]*/);
    if (m) s = m[0];
    s = s.replace(/&amp;/g, "&");
    return /^https?:\/\//.test(s) ? s : "";
  } catch { return ""; }
}

// Progressive .mp4 via Instagram's own surfaces (what yt-dlp tries first):
//  1. /p/<code>/embed/captioned/ HTML (contains video_url, no auth wall)
//  2. /p/<code>/?__a=1&__d=dis JSON (needs session, has video_versions)
// Results cached per shortcode for the session.
const progCache = new Map();
async function fetchProgressiveMp4(shortcode) {
  const code = String(shortcode || "").replace(/\/$/, "");
  if (!code) return "";
  if (progCache.has(code)) return progCache.get(code) || "";
  let found = "";
  // 1. Embed page.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch("https://www.instagram.com/p/" + encodeURIComponent(code) + "/embed/captioned/", {
      credentials: "include",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const html = await res.text();
      let m = html.match(/"video_url"\s*:\s*"([^"]+)"/) || html.match(/video_url\\*"\s*:\s*\\*"([^"\\]+)/);
      if (m && m[1]) found = cleanMp4(m[1]);
      if (!found) {
        const m2 = html.match(/"video_versions"\s*:\s*\[([\s\S]{0,3000}?)\]/);
        if (m2) {
          const urls = [...m2[1].matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((x) => cleanMp4(x[1])).filter(Boolean);
          if (urls.length) found = urls[urls.length - 1];
        }
      }
      if (!found) {
        const m3 = html.match(/(https?:\/\/[^"'\s\\]+\.mp4[^"'\s\\]*)/);
        if (m3) found = cleanMp4(m3[1]);
      }
    }
  } catch {}
  // 2. ?__a=1 JSON (authenticated, biggest video_versions).
  if (!found) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const res = await fetch("https://www.instagram.com/p/" + encodeURIComponent(code) + "/?__a=1&__d=dis", {
        credentials: "include",
        headers: { "x-ig-app-id": IG_APP_ID },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const j = await res.json();
        found = deepScanVideoUrl(j) || "";
      }
    } catch {}
  }
  try {
    progCache.set(code, found || "");
    if (progCache.size > 40) {
      const first = progCache.keys().next().value;
      progCache.delete(first);
    }
  } catch {}
  return found || "";
}

// Optional local yt-dlp bridge: POST {url, filename} to the companion
// server (ytdlp-server.py). 1.2s timeout — never blocks the normal flow.
async function tryLocalBridge(pageUrl, filename) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: String(pageUrl || location.href), filename: String(filename || "") }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return j && j.saved ? j : null;
  } catch {
    return null;
  }
}

// One-click site handoff: 3-dots → Download → hidden page auto-saves.
// mid = already-resolved direct file (fastest: page skips the API).
// Single-flight guard: double-clicks never open two tabs.
let lastSiteOpen = 0;
function buildSiteUrl(pageUrl, directUrl, filename) {
  try {
    const p = new URLSearchParams();
    p.set("url", String(pageUrl || location.href));
    p.set("auto", "1");
    p.set("src", "ext");
    if (directUrl && /^https?:\/\//.test(directUrl)) p.set("mid", directUrl);
    if (filename) p.set("fn", String(filename).slice(0, 120));
    return SITE_BASE + "?" + p.toString();
  } catch {
    return SITE_BASE + "?url=" + encodeURIComponent(String(pageUrl || location.href)) + "&auto=1&src=ext";
  }
}
function openSiteDownloader(pageUrl, directUrl, filename) {
  try {
    const now = Date.now();
    if (now - lastSiteOpen < 3000) return true; // already opening
    lastSiteOpen = now;
    window.open(buildSiteUrl(pageUrl, directUrl, filename), "_blank", "noopener");
    return true;
  } catch {
    return false;
  }
}

// Protected/DASH fallback: local bridge (zero-click) → hidden site page
// (auto-download, one tab) → clipboard command as last resort. No dialogs,
// no extra taps: Download just works.
function showProtectedFallback(pageUrl, filename, directUrl) {
  const url = String(pageUrl || location.href);
  const name = String(filename || `gramiqo-${Date.now()}.mp4`);
  // Fire-and-forget bridge attempt — success toasts from here.
  try {
    tryLocalBridge(url, name).then((j) => {
      if (j && j.saved) toastLocal("Saved via local yt-dlp bridge!");
    }).catch(() => {});
  } catch {}
  try {
    if (openSiteDownloader(url, directUrl || "", name)) {
      toastLocal("Opening Gramiqo downloader…");
      return;
    }
  } catch {}
  // Popups blocked → at least hand over the exact yt-dlp command.
  copyTextRaw(ytdlpCommand(url, name), "Allow popups — yt-dlp command copied instead!");
}

try {
  window.GramiqoDl = {
    shortcodeFromUrl, pageShortcode, pageUrlForShortcode,
    ytdlpCommand, tryLocalBridge, fetchProgressiveMp4,
    deepScanVideoUrl, showProtectedFallback, copyYtDlp: copyTextRaw,
    buildSiteUrl, openSiteDownloader,
  };
} catch {}
})();
