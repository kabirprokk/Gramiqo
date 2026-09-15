/* ============================================================
   Inta-Enhancer - content.js v1.3.0 (production)
   Runs INSIDE every instagram.com page. No floating panel.
   Everything is injected NATIVELY + guarded for SPA nav.
   ============================================================ */
(() => {
"use strict";

// Shared inline-SVG icons (icons.js loads first). Fallback "" keeps UI working.
const ic = (n, s) => {
  try {
    return window.IntaIcons ? window.IntaIcons.svg(n, s || 16) : "";
  } catch {
    return "";
  }
};

const DEFAULTS = {
  downloadBtn: true,
  hdPfp: true,
  copyCaption: true,
  zoomHover: true,
  darkMode: false,
  wideFeed: false,
  enhancedSearch: true, // owned by search.js
  mobileMode: false,    // OFF by default: desktop bundle renders correctly; opt-in for iPhone feel
  profileTools: true,   // mobile-like profile + edit helpers + nav link
  // power.js owns these (listed here so storage sync stays compatible)
  storySaver: true,
  reelsToolkit: true,
  bulkSaver: true,
  cmdPalette: true,
  statsHistory: true,
  hashtagTools: true,
  ghostMode: false,
  centerStage: true,
  quickCreate: true,
  dataSaver: false,
  autoUnmute: true,
  reelRedirect: false,
  clickOpensReel: true,
};

const RESERVED = new Set([
  "explore", "reels", "reel", "p", "stories", "direct", "inbox",
  "accounts", "settings", "emails", "about", "developer", "legal",
  "privacy", "terms", "directory", "lite", "static", "api", "graphql",
  "oauth", "web", "arthur", "dgs", "nametag",
]);

// Same public app id the web client uses (also used by search.js).
const IG_APP_ID = "936619743392459";
// Instagram caps bio links at 5.
const MAX_BIO_LINKS = 5;

let settings = { ...DEFAULTS };
let lastUrl = location.href;
let enhanceScheduled = false;
let lens = null;
let lensBound = false;

init().catch((e) => console.warn("[Inta-Enhancer] init failed", e));

async function init() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
  } catch (e) {
    console.warn("[Inta-Enhancer] storage not ready, using defaults", e);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const k in changes) {
        if (k in settings) settings[k] = changes[k].newValue;
      }
      applyTheme();
      applyWideFeed();
      applyMobileFrame();
      if (changes.profileTools || changes.hdPfp) {
        cleanupStaleInjects();
        scheduleEnhance(0);
      }
    });
  } catch {}
  // Popup → page bridge (e.g. "All settings hub" button).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "INTA_OPEN_SETTINGS") {
        try {
          if (typeof window.IntaOpenSettings === "function") window.IntaOpenSettings();
        } catch {}
      }
      return false;
    });
  } catch {}

  createZoomLens();
  applyTheme();
  applyWideFeed();
  applyMobileFrame();
  bindShortcuts();

  const observer = new MutationObserver((mutations) => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onRouteChange();
      return;
    }
    if (document.hidden) return;
    // Ignore our own UI + non-structural churn (hover states, image loads).
    // Hammering enhanceAll on every mutation is what made clicks feel dead.
    let relevant = false;
    for (const m of mutations) {
      if (m.target?.closest?.("#inta-wrap, #inta-top-search, #inta-edit-helper, #inta-profile-bar, #inta-toast, #inta-lens, #inta-modal, #inta-links-modal, #inta-palette, #inta-bulk, #inta-settings, #inta-search-overlay, #inta-reel-menu, .inta-reel-bar, .inta-story-dl")) continue;
      const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
      if (!nodes.length) continue;
      if (nodes.some((n) => n.nodeType === 1 && (n.matches?.("article, video, header, main, nav") || n.querySelector?.("article, video, header, main")))) {
        relevant = true;
        break;
      }
    }
    if (relevant) scheduleEnhance(900);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  scheduleEnhance(0);
  onRouteChange();
  watchBlankPage();
  console.log("[Inta-Enhancer] OLIN 1.1.b loaded. Keys: D=download C=caption F=fullscreen P=PiP /=search Ctrl+K=commands");
}

/* Blank-page watchdog: if Mobile feel's iPhone UA leaves instagram.com an
   empty shell (no readable content after load), say so with the one-tap
   fix instead of silence. Only ever fires when Mobile feel is ON. */
let blankWarned = false;
function watchBlankPage() {
  try {
    setTimeout(() => {
      try {
        if (blankWarned || !settings.mobileMode || document.hidden) return;
        const main = document.querySelector("main");
        const textLen = (main?.innerText || document.body?.innerText || "").trim().length;
        const hasMedia = !!document.querySelector("main article, main video, main img, nav a[href]");
        if (main && (textLen > 300 || hasMedia)) return; // page is alive
        blankWarned = true;
        toast("Instagram looks blank with Mobile feel ON — turn it OFF in the popup");
      } catch {}
    }, 12000);
  } catch {}
}

/* ---------------- scheduler ---------------- */

function scheduleEnhance(delay = 900) {
  if (enhanceScheduled) return;
  enhanceScheduled = true;
  const run = () => {
    enhanceScheduled = false;
    if (document.hidden) return;
    try {
      enhanceAll();
    } catch (e) {
      console.warn("[Inta-Enhancer] enhance failed", e);
    }
  };
  // Idle callback keeps clicks smooth; fallback to timeout.
  if (delay <= 0) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 800 });
    else setTimeout(run, 0);
  } else {
    setTimeout(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 800 });
      else run();
    }, delay);
  }
}

function enhanceAll() {
  if (location.hostname !== "www.instagram.com" && !location.hostname.endsWith(".instagram.com")) return;
  // Isolated steps: one failing injector can never kill the rest.
  const steps = [addMenuToPosts, enhanceReelsPage, enhanceProfilePage, enhanceEditPage, enhanceLinksEditor, enhanceTopSearch, makeAvatarsClickable];
  for (const fn of steps) {
    try {
      fn();
    } catch (e) {
      console.warn("[Inta-Enhancer] enhance step failed", fn && fn.name, e);
    }
  }
}

function onRouteChange() {
  cleanupStaleInjects();
  applyTheme();
  applyWideFeed();
  applyMobileFrame();
  scheduleEnhance(100);
}

function cleanupStaleInjects() {
  // Top-search pill only belongs on feed-class pages; SPA nav can leave
  // it behind in a persisting <main> — pull it so it re-injects cleanly.
  try {
    const ts = document.querySelector("#inta-top-search");
    if (ts) {
      const p = pathName();
      const allow = p === "/" || p.startsWith("/explore") || p.startsWith("/reels") || p.startsWith("/reel");
      if (!allow || (!settings.mobileMode && !settings.profileTools)) ts.remove();
    }
  } catch {}
  // Remove bars whose anchor is gone (SPA nav), so they re-inject cleanly.
  for (const id of ["#inta-profile-bar", "#inta-edit-helper", "#inta-top-search", "#inta-links-btn"]) {
    const el = document.querySelector(id);
    if (el && !el.isConnected) el.remove();
  }
  // If profileTools turned off, remove our UI.
  if (!settings.profileTools) {
    document.querySelector("#inta-profile-bar")?.remove();
    document.querySelector("#inta-edit-helper")?.remove();
    document.querySelector("#inta-links-btn")?.remove();
    document.querySelector("#inta-links-modal")?.remove();
  }
  if (!settings.profileTools && !settings.mobileMode) {
    document.querySelector("#inta-top-search")?.remove();
  }
  if (!settings.hdPfp) {
    document.querySelectorAll(".inta-avatar-badge").forEach((b) => b.remove());
  }
}

/* ---------------- route helpers ---------------- */

function pathName() {
  return location.pathname || "/";
}

function getProfileUsername() {
  const m = pathName().match(/^\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/);
  if (!m) return null;
  if (RESERVED.has(m[1].toLowerCase())) return null;
  return m[1];
}

function isEditPage() {
  const p = pathName();
  return (
    p.startsWith("/accounts/") ||
    p.startsWith("/settings/") ||
    p === "/settings" ||
    p.startsWith("/emails/")
  );
}

// Only the profile-edit form gets the helper (not every settings list).
function isProfileEditForm() {
  const p = pathName();
  return p === "/accounts/edit/" || p === "/accounts/edit" || p.startsWith("/accounts/password/change");
}

/* ---------------- media finding (class-name agnostic) ---------------- */

function getVisibleMedia() {
  try {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const el = document.elementFromPoint(cx, cy);
    if (!el) return null;

    const video =
      el.closest?.("video") || el.querySelector?.("video") || findCenterVideo();
    const article = el.closest?.("article") || findCenterArticle();

    let img = null;
    if (article) {
      const imgs = [...article.querySelectorAll("img")].filter(
        (i) => i.naturalWidth > 200 && !isJunkImg(i)
      );
      imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
      img = imgs[0] || null;
    }
    if (!img) img = findCenterImage();

    if (video) {
      const url =
        video.currentSrc || video.src || video.querySelector("source")?.src || "";
      if (url) return { type: "video", el: video, url };
    }
    if (img) return { type: "image", el: img, url: pickBestSrc(img) };
    if (video) return { type: "video", el: video, url: "" }; // blob w/o url yet
    return null;
  } catch {
    return null;
  }
}

function isJunkImg(img) {
  const s = (img.src || "").toLowerCase();
  return s.includes("s150x150") || s.includes("emoji") || s.includes("sprite");
}

function findCenterVideo() {
  return bestInViewport([...document.querySelectorAll("video")]);
}

function findCenterImage() {
  const imgs = [...document.querySelectorAll("article img, main img")].filter(
    (i) => i.naturalWidth > 300 && i.getBoundingClientRect().height > 150
  );
  return bestInViewport(imgs);
}

function findCenterArticle() {
  const arts = [...document.querySelectorAll("article")];
  return bestInViewport(arts);
}

function bestInViewport(els) {
  let best = null;
  let bestScore = -Infinity;
  const cy = window.innerHeight / 2;
  for (const el of els) {
    let r;
    try {
      r = el.getBoundingClientRect();
    } catch {
      continue;
    }
    if (!r || r.bottom < 0 || r.top > window.innerHeight || r.width < 50) continue;
    const centerDist = Math.abs(r.top + r.height / 2 - cy);
    const score = r.width * r.height - centerDist * 2;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function pickBestSrc(img) {
  try {
    if (img.srcset) {
      const parts = img.srcset.split(",").map((s) => s.trim().split(" "));
      const last = parts[parts.length - 1]?.[0];
      if (last && last.startsWith("http")) return last;
    }
  } catch {}
  return img.currentSrc || img.src || "";
}

function hdUpgrade(url) {
  if (!url) return url;
  return String(url)
    .replace(/s\d+x\d+/g, "s1080x1080")
    .replace(/w=\d+/g, "w=1080");
}

/* ---------------- download ---------------- */

function downloadUrl(url, filename) {
  if (!url) return toast("No media found");
  toast("Downloading…"); // instant feedback — the wait popup, before any work
  if (url.startsWith("blob:")) {
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("fetch " + r.status);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000);
        toast("Downloading…");
      })
      .catch(() => toast("Can't download this video (protected)"));
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "INTA_DOWNLOAD", url, filename }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) toast("Download blocked — right-click > Save");
      // Success was already announced instantly below — stay quiet.
    });
  } catch {
    toast("Download unavailable here");
  }
}

function downloadVisibleMedia() {
  if (!settings.downloadBtn) return toast("Enable Download in popup first");
  const m = getVisibleMedia();
  if (!m || !m.url) return toast("Scroll to a photo/reel first");
  const ext = m.type === "video" ? "mp4" : "jpg";
  downloadUrl(m.url, `insta-${m.type}-${Date.now()}.${ext}`);
}

// Resolve the BEST savable video URL: element URL → network-remembered
// direct file → page og:video → blob (last resort). Blob/MSE streams are
// what Instagram protects — the remembered .mp4 beats them every time.
function sendMsg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res || null);
      });
    } catch {
      resolve(null);
    }
  });
}
function pageVideoUrl() {
  try {
    const p = pathName();
    if (!/^\/p\/[^/]+\/?$/.test(p) && !/^\/reel\/[^/]+\/?$/.test(p)) return "";
    const meta = document.querySelector('meta[property="og:video"], meta[property="og:video:secure_url"]');
    const u = meta?.getAttribute("content") || meta?.content || "";
    return /^https?:\/\//.test(u) ? u : "";
  } catch { return ""; }
}
async function resolveDownloadUrl(video) {
  try {
    const cur = video ? (video.currentSrc || video.src || "") : "";
    if (/^https?:\/\//.test(cur) && !cur.startsWith("blob:")) return { url: cur, via: "direct" };
    const remembered = await sendMsg({ type: "INTA_GET_MEDIA" });
    if (remembered?.url && /^https?:\/\//.test(remembered.url)) return { url: remembered.url, via: "network" };
    const og = pageVideoUrl();
    if (og) return { url: og, via: "page" };
    if (cur) return { url: cur, via: "blob" };
  } catch {}
  return { url: "", via: "" };
}

/* ---------------- MP3 audio (320kbps, on-device, no server) ----------------
   FAST PATH (new): fetch the video file itself → native decode →
   OfflineAudioContext render at full CPU speed → lamejs 320k MP3.
   Seconds, not realtime — no playback, tab can even be backgrounded.
   FALLBACK (old): tap the playing <video> and capture one realtime pass
   (blob: URLs, protected streams). Whatever you hear is what gets saved. */
async function downloadMp3FromElement(video) {
  if (!settings.downloadBtn) return toast("Enable Download in popup first");
  if (!video) return toast("Video still loading — wait a second");
  if (!window.lamejs?.Mp3Encoder) return toast("Audio engine missing — reload the extension");
  toast("Preparing MP3…"); // instant feedback — the wait popup
  // Best file first: network-remembered direct .mp4 beats blob/protected.
  let url = "";
  try {
    const r = await resolveDownloadUrl(video);
    url = r.url || "";
  } catch {}
  if (!url) url = video.currentSrc || video.src || "";
  if (url && /^https?:\/\//.test(url)) {
    try {
      await downloadMp3Fast(url);
      return;
    } catch (e) {
      console.warn("[Inta-Enhancer] fast mp3 failed, realtime fallback", e);
    }
  }
  await downloadMp3Realtime(video);
}

async function downloadMp3Fast(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch {} }, 90000);
  try {
    const res = await fetch(url, { credentials: "include", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    // Visible progress: quartile toasts while the file streams in.
    let raw = null;
    try {
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader && total > 0) {
        const chunks = [];
        let got = 0;
        let mark = 0;
        for (;;) {
          const step = await reader.read();
          if (step.done) break;
          const v = step.value;
          chunks.push(v);
          got += v.byteLength || v.length || 0;
          const pct = Math.floor((got / total) * 100);
          if (pct >= mark + 25 && pct < 100) {
            mark = pct - (pct % 25);
            toast(`Fetching audio ${mark}%…`);
          }
        }
        raw = concatU8(chunks, got);
      } else {
        raw = await res.arrayBuffer();
      }
    } catch (e) {
      if (!raw) throw e;
    }
    if (!raw || !raw.byteLength) throw new Error("empty-file");
  toast("Decoding audio…");
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) throw new Error("no-offline");
  const scratch = new AC(1, 44100, 44100);
  const decoded = await new Promise((resolve, reject) => {
    try {
      const p = scratch.decodeAudioData(raw.slice(0), resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
  const dur = Math.min(Number(decoded.duration) || 0, 600);
  if (!dur || !isFinite(dur) || dur < 0.5) throw new Error("no-duration");
  const rate = 44100;
  const off = new AC(decoded.numberOfChannels >= 2 ? 2 : 1, Math.ceil(dur * rate), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  try { src.start(0, 0, dur); } catch { try { src.start(0); } catch {} }
  const rendered = await off.startRendering();
  toast("Encoding MP3…");
  const L = rendered.getChannelData(0);
  const R = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : L;
  const parts = await encodePcmAsync(rate, L, R);
  if (!parts.length) throw new Error("encode-empty");
  const blob = new Blob(parts, { type: "audio/mpeg" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `insta-audio-${Date.now()}.mp3`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  toast("Audio saved!");
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  clearTimeout(timer);
}

async function downloadMp3Realtime(video) {
  if (!settings.downloadBtn) return toast("Enable Download in popup first");
  if (!video) return toast("Video still loading — wait a second");
  if (video.dataset.intaCaptured) return toast("Reload the page for another capture");
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return toast("Audio not supported here");
  if (!window.lamejs?.Mp3Encoder) return toast("Audio engine missing — reload the extension");
  toast("Recording audio — keep this tab open…");
  let ctx = null;
  let src = null;
  let proc = null;
  const prevMuted = video.muted;
  const prevRate = video.playbackRate;
  const prevLoop = video.loop;
  try {
    ctx = new Ctx();
    try { await ctx.resume(); } catch {}
    try {
      src = ctx.createMediaElementSource(video);
    } catch (e) {
      throw new Error("tap-used");
    }
    const chL = [];
    const chR = [];
    proc = ctx.createScriptProcessor(4096, 2, 2);
    proc.onaudioprocess = (e) => {
      try {
        const ib = e.inputBuffer;
        chL.push(new Float32Array(ib.getChannelData(0)));
        chR.push(
          ib.numberOfChannels > 1
            ? new Float32Array(ib.getChannelData(1))
            : new Float32Array(ib.getChannelData(0))
        );
      } catch {}
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    // Mark manual so Data Saver never pauses our capture mid-take.
    try { video.dataset.intaManual = "1"; } catch {}
    video.muted = false;
    try { video.volume = 1; } catch {}
    video.loop = false;
    try { video.currentTime = 0; } catch {}
    try {
      await video.play();
    } catch (e) {
      throw new Error("play-blocked");
    }
    const dur = Number(video.duration);
    const capMs = (Number.isFinite(dur) && dur > 0 ? Math.min(dur, 600) : 120) * 1000 + 6000;
    await waitVideoEnd(video, capMs);
    const sr = ctx.sampleRate || 44100;
    const L = concatF32(chL);
    const R = concatF32(chR);
    try { proc.disconnect(); } catch {}
    try { src.disconnect(); } catch {}
    try { await ctx.close(); } catch {}
    ctx = null;
    try { video.pause(); } catch {}
    video.muted = prevMuted;
    try { video.playbackRate = prevRate; } catch {}
    video.loop = prevLoop;
    if (!L.length) throw new Error("empty-capture");
    const parts = encodePcm(sr, L, R);
    if (!parts.length) throw new Error("encode-empty");
    try { video.dataset.intaCaptured = "1"; } catch {}
    const blob = new Blob(parts, { type: "audio/mpeg" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `insta-audio-${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    toast("Audio saved!");
  } catch (e) {
    try { proc?.disconnect(); } catch {}
    try { src?.disconnect(); } catch {}
    try { await ctx?.close(); } catch {}
    try { video.pause(); } catch {}
    try {
      video.muted = prevMuted;
      video.playbackRate = prevRate;
      video.loop = prevLoop;
    } catch {}
    const msg = String((e && e.message) || e || "");
    console.warn("[Inta-Enhancer] mp3 failed", e);
    if (msg === "play-blocked") toast("Tap the video once, then retry");
    else if (msg === "tap-used") toast("Reload the page for another capture");
    else toast("Couldn't capture audio here");
  }
}

function waitVideoEnd(video, capMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { video.removeEventListener("ended", finish); } catch {}
      resolve();
    };
    try { video.addEventListener("ended", finish); } catch {}
    setTimeout(finish, Math.max(5000, Math.min(capMs || 60000, 660000)));
  });
}

function concatF32(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function concatU8(chunks, total) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    try {
      const u = c instanceof Uint8Array ? c : new Uint8Array(c.buffer || c);
      out.set(u.subarray(0, Math.min(u.length, total - off)), off);
      off += Math.min(u.length, total - off);
    } catch {}
  }
  return off > 0 ? out.buffer : new ArrayBuffer(0);
}

// Non-blocking encode: yields to the page every chunk so long audio never
// freezes the tab. (Sync encodePcm below stays for the realtime path.)
async function encodePcmAsync(sampleRate, ch0, ch1) {
  const sr = sampleRate || 44100;
  const channels = ch1 && ch1.length === ch0.length ? 2 : 1;
  const enc = new window.lamejs.Mp3Encoder(channels, sr, 320);
  const toI16 = (f) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      o[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return o;
  };
  const L = toI16(ch0);
  const R = channels === 2 ? toI16(ch1) : null;
  const out = [];
  const FRAME = 1152;
  let n = 0;
  for (let i = 0; i < L.length; i += FRAME) {
    const l = L.subarray(i, i + FRAME);
    const r = R ? R.subarray(i, i + FRAME) : l;
    let d = null;
    try {
      d = channels === 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    } catch {
      break;
    }
    if (d && d.length) out.push(new Uint8Array(d.buffer, d.byteOffset, d.length));
    n += 1;
    if (n % 512 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  try {
    const end = enc.flush();
    if (end && end.length) out.push(new Uint8Array(end.buffer, end.byteOffset, end.length));
  } catch {}
  return out;
}

function encodePcm(sampleRate, ch0, ch1) {
  const sr = sampleRate || 44100;
  const channels = ch1 && ch1.length === ch0.length ? 2 : 1;
  const enc = new window.lamejs.Mp3Encoder(channels, sr, 320);
  const toI16 = (f) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      o[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return o;
  };
  const L = toI16(ch0);
  const R = channels === 2 ? toI16(ch1) : null;
  const out = [];
  const FRAME = 1152;
  for (let i = 0; i < L.length; i += FRAME) {
    const l = L.subarray(i, i + FRAME);
    const r = R ? R.subarray(i, i + FRAME) : l;
    let d = null;
    try {
      d = channels === 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    } catch {
      break;
    }
    if (d && d.length) out.push(new Uint8Array(d.buffer, d.byteOffset, d.length));
  }
  try {
    const end = enc.flush();
    if (end && end.length) out.push(new Uint8Array(end.buffer, end.byteOffset, end.length));
  } catch {}
  return out;
}

function articleMedia(article) {
  const video = article.querySelector("video");
  const vUrl = video
    ? video.currentSrc || video.src || video.querySelector("source")?.src || ""
    : "";
  if (vUrl) return { type: "video", url: vUrl };
  const imgs = [...article.querySelectorAll("img")]
    .filter((i) => i.naturalWidth > 200 && !isJunkImg(i));
  imgs.sort((a, b) => b.naturalWidth - a.naturalWidth);
  if (imgs[0]) return { type: "image", url: pickBestSrc(imgs[0]) };
  return null;
}

function addMenuToPosts() {
  bindMenuDismiss();
  document.querySelectorAll("article").forEach((article) => {
    if (article.querySelector(":scope > .inta-menu-wrap")) return;
    // Upgrade path: remove legacy single buttons.
    article.querySelectorAll(":scope > .inta-dl, :scope > .inta-mp3, :scope > .inta-copy").forEach((b) => { try { b.remove(); } catch {} });
    try {
      if (getComputedStyle(article).position === "static") article.style.position = "relative";
    } catch {}
    const wrap = document.createElement("div");
    wrap.className = "inta-menu-wrap";
    const btn = document.createElement("button");
    btn.className = "inta-menu";
    btn.type = "button";
    btn.textContent = "•••";
    btn.title = "Post actions (Inta-Enhancer)";
    btn.setAttribute("aria-label", "Post actions");
    swallowToggle(btn);
    const pop = document.createElement("div");
    pop.className = "inta-menu-pop";
    pop.setAttribute("role", "menu");
    try { pop.style.display = "none"; } catch {} // hidden even if CSS fails
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const was = pop.classList.contains("open");
      closeAllMenus(null);
      try { document.querySelectorAll(".inta-menu-pop").forEach((p) => { p.style.display = "none"; }); } catch {}
      if (!was) {
        pop.classList.add("open");
        try { pop.style.display = "block"; } catch {}
      }
    });
    if (settings.downloadBtn) {
      pop.appendChild(menuRow("download", "Download", async () => {
        const media = articleMedia(article);
        if (!media) return toast("No media found in this post");
        if (media.type !== "video") {
          const ext = "jpg";
          return downloadUrl(media.url, `insta-image-${Date.now()}.${ext}`);
        }
        toast("Finding video…");
        const v = article.querySelector("video");
        const r = await resolveDownloadUrl(v);
        if (!r.url) return toast("Video still loading — wait a second");
        downloadUrl(r.url, `insta-video-${Date.now()}.mp4`);
      }));
      if (article.querySelector("video")) {
        pop.appendChild(menuRow("music", "Audio MP3", () => {
          const v = article.querySelector("video");
          if (!v) return toast("Video still loading — wait a second");
          downloadMp3FromElement(v);
        }));
      }
    }
    if (settings.copyCaption) {
      pop.appendChild(menuRow("copy", "Copy caption", () => {
        const t = articleCaption(article);
        if (!t) return toast("No caption found");
        copyText(t, "Caption copied!");
      }));
    }
    if (settings.hashtagTools) {
      pop.appendChild(menuRow("hash", "Copy hashtags", () => {
        const tags = articleHashtags(article);
        if (!tags.length) return toast("No hashtags here");
        copyText(tags.join(" "), `${tags.length} hashtags copied!`);
      }));
    }
    pop.appendChild(menuRow("link", "Copy link", () => {
      const href = articleLink(article);
      if (!href) return toast("No link found here");
      copyText(href, "Post link copied!");
    }));
    wrap.appendChild(btn);
    wrap.appendChild(pop);
    article.appendChild(wrap);
  });
}

/* ---------------- one menu per post (super-simple UI) ----------------
   A single ⋯ button on each article; every action lives in its dropdown:
   Download, Audio MP3, Copy caption, Copy hashtags, Copy link.
   PC look (adapts to IG light/dark via system colors), mobile system
   underneath. Legacy single buttons are removed on sight (upgrade path). */
let menuDocBound = false;
function closeAllMenus(except) {
  try {
    // Hide by selector WITHOUT the .open filter: class and inline display
    // can never desync into a stuck-open dropdown again.
    document.querySelectorAll(".inta-menu-pop").forEach((p) => {
      if (p !== except) {
        try { p.classList.remove("open"); } catch {}
        try { p.style.display = "none"; } catch {}
      }
    });
  } catch {}
}
function bindMenuDismiss() {
  if (menuDocBound) return;
  menuDocBound = true;
  document.addEventListener("click", (e) => {
    try {
      if (!e.target?.closest?.(".inta-menu-wrap")) closeAllMenus(null);
    } catch {}
  }, true);
  document.addEventListener("keydown", (e) => {
    try { if (e.key === "Escape") closeAllMenus(null); } catch {}
  }, true);
}
function articleCaption(article) {
  try {
    const texts = [...article.querySelectorAll("span, div[dir='auto']")]
      .map((el) => (el.innerText || "").trim())
      .filter((t) => t.length > 20 && t.includes(" "));
    texts.sort((a, b) => b.length - a.length);
    return texts[0] || "";
  } catch { return ""; }
}
function articleHashtags(article) {
  try {
    const found = (article.innerText || "").match(/#[\p{L}\p{N}_]+/gu);
    return found ? [...new Set(found)] : [];
  } catch { return []; }
}
function articleLink(article) {
  try {
    const a = article.querySelector('a[href^="/p/"], a[href^="/reel/"], a[href*="/p/"], a[href*="/reel/"]');
    const href = a?.getAttribute("href") || "";
    if (!href) return "";
    return href.startsWith("http") ? href : "https://www.instagram.com" + href;
  } catch { return ""; }
}
function menuRow(icon, label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "inta-menu-row";
  try { b.style.display = "block"; b.style.width = "100%"; } catch {} // stacked even if CSS fails
  b.innerHTML = ic(icon, 15) + "<span></span>";
  b.lastChild.textContent = label;
  swallowToggle(b);
  b.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { closeAllMenus(null); } catch {}
    try { fn(); } catch {}
  });
  return b;
}
// Instagram toggles video play on pointerdown/mousedown of the container —
// a bubble-phase click stop is NOT enough when the video layer paints over
// us. Swallow the whole gesture family on our controls so taps can never
// leak through to the video underneath.
function swallowToggle(el) {
  try {
    for (const t of ["pointerdown", "mousedown", "touchstart"]) {
      el.addEventListener(t, (e) => {
        try { e.stopPropagation(); } catch {}
      }, true);
    }
  } catch {}
}

// Legacy single-button builders removed: addMenuToPosts() owns articles now
// (one ⋯ menu per post). Kept as no-ops in case any older tick calls them.

/* ---------------- copy caption ---------------- */

function findVisibleCaption() {
  try {
    const m = getVisibleMedia();
    const scope = m?.el?.closest("article") || document.querySelector("article");
    if (!scope) return "";
    const candidates = [...scope.querySelectorAll("span, div[dir='auto'], h1")]
      .map((el) => (el.innerText || "").trim())
      .filter((t) => t.length > 20 && t.includes(" "));
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0] || "";
  } catch {
    return "";
  }
}

function copyVisibleCaption() {
  if (!settings.copyCaption) return toast("Enable Copy Caption in popup first");
  const text = findVisibleCaption();
  if (!text) return toast("No caption found");
  copyText(text, "Caption copied!");
}

function copyText(text, okMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(okMsg || "Copied!"),
      () => fallbackCopy(text, okMsg)
    );
  } else {
    fallbackCopy(text, okMsg);
  }
}

function fallbackCopy(text, okMsg) {  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(okMsg || "Copied!");
  } catch {
    toast("Copy failed");
  }
}

/* ---------------- HD profile pic + modal ---------------- */

function findAvatarImg() {
  const header = document.querySelector("header");
  const scope = header || document;
  const imgs = [...scope.querySelectorAll("img")];
  // Prefer instagram CDN avatar, biggest in header.
  const cdn = imgs.filter(
    (i) => /cdninstagram|fbcdn/i.test(i.src || "") && i.naturalWidth >= 40
  );
  if (cdn.length) {
    cdn.sort((a, b) => b.naturalWidth - a.naturalWidth);
    return cdn[0];
  }
  // Fallback: largest header img that isn't a logo.
  const rest = imgs.filter((i) => i.naturalWidth >= 80);
  rest.sort((a, b) => b.naturalWidth - a.naturalWidth);
  return rest[0] || null;
}

function openHdProfilePic() {
  if (!settings.hdPfp) return toast("Enable HD Pic in popup first");
  const avatar = findAvatarImg();
  if (!avatar || !avatar.src) return toast("Open a profile page first");
  const hd = hdUpgrade(pickBestSrc(avatar));
  openModal(hd, getProfileUsername() || "profile");
}

function openModal(imgUrl, username) {
  closeModal();
  const wrap = document.createElement("div");
  wrap.id = "inta-modal";
  wrap.innerHTML = `
    <div class="inta-modal-backdrop" data-close="1"></div>
    <div class="inta-modal-card" role="dialog" aria-label="HD profile picture">
      <img class="inta-modal-img" src="" alt="HD profile picture" />
      <div class="inta-modal-row">
        <span class="inta-modal-user"></span>
        <span class="inta-modal-actions">
          <button type="button" data-mact="download">${ic("download", 14)}<span>Download</span></button>
          <button type="button" data-mact="open">${ic("external", 14)}<span>Full size</span></button>
          <button type="button" data-mact="close">${ic("x", 14)}<span>Close</span></button>
        </span>
      </div>
    </div>`;
  wrap.querySelector(".inta-modal-img").src = imgUrl;
  wrap.querySelector(".inta-modal-user").textContent = "@" + username;
  wrap.addEventListener("click", (e) => {
    const closer = e.target.closest?.("[data-close]");
    const btn = e.target.closest?.("[data-mact]");
    if (closer) return closeModal();
    if (!btn) return;
    const act = btn.dataset.mact;
    if (act === "close") closeModal();
    if (act === "open") window.open(imgUrl, "_blank", "noopener");
    if (act === "download") downloadUrl(imgUrl, `insta-pfp-${username}-${Date.now()}.jpg`);
  });
  document.documentElement.appendChild(wrap);
  document.addEventListener("keydown", escClose, { once: true });
}

function escClose(e) {
  if (e.key === "Escape") closeModal();
}

function closeModal() {
  document.querySelector("#inta-modal")?.remove();
}

// Non-destructive: small HD badge on avatars, avatar click untouched (stories still work).
function makeAvatarsClickable() {
  if (!settings.hdPfp) return;
  const username = getProfileUsername();
  if (!username) return;
  const header = document.querySelector("header");
  if (!header) return;
  const avatar = findAvatarImg();
  if (!avatar || avatar.dataset.intaBadge) return;
  avatar.dataset.intaBadge = "1";
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "inta-avatar-badge";
  badge.innerHTML = ic("search", 11) + "<span>HD</span>";
  badge.title = "View HD profile picture";
  badge.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openHdProfilePic();
  });
  try {
    const parent = avatar.parentElement;
    if (parent) {
      if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
      parent.appendChild(badge);
    }
  } catch {}
}

/* ---------------- profile page (mobile-like) ---------------- */

function enhanceProfilePage() {
  if (!settings.profileTools && !settings.hdPfp) return;
  const username = getProfileUsername();
  if (!username) return;
  // Inject AFTER the header, never inside it — appending inside header
  // flex broke stats layout ("follower s / followin g" wrap in screenshot).
  const header = document.querySelector("header");
  if (!header || !header.parentElement) return;
  if (document.querySelector("#inta-profile-bar")) return;

  const bar = document.createElement("div");
  bar.id = "inta-profile-bar";
  bar.innerHTML = `
    <button type="button" data-pact="hd" title="View HD profile picture">${ic("user")}<span>HD Pic</span></button>
    <button type="button" data-pact="copy" title="Copy profile link">${ic("link")}<span>Copy link</span></button>
    <button type="button" data-pact="avatar" title="Download HD avatar">${ic("download")}<span>Avatar</span></button>
    <button type="button" data-pact="stats" title="Copy name, stats and bio as text">${ic("chart")}<span>Stats</span></button>
    <button type="button" data-pact="edit" title="Edit your profile">${ic("edit")}<span>Edit profile</span></button>
  `;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-pact]");
    if (!btn) return;
    const act = btn.dataset.pact;
    const profileUrl = `https://www.instagram.com/${username}/`;
    if (act === "hd") openHdProfilePic();
    if (act === "copy") copyText(profileUrl, "Profile link copied!");
    if (act === "avatar") {
      const avatar = findAvatarImg();
      if (!avatar) return toast("Avatar not found yet — scroll up");
      downloadUrl(hdUpgrade(pickBestSrc(avatar)), `insta-pfp-${username}-${Date.now()}.jpg`);
    }
    if (act === "stats") copyProfileStats(username, profileUrl);
    if (act === "edit") location.href = "https://www.instagram.com/accounts/edit/";
  });
  header.after(bar);
}

// Powerful one-tap media kit: name + stats + bio + link, copied as text.
function copyProfileStats(username, profileUrl) {
  try {
    const header = document.querySelector("header");
    const text = (header?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 14);
    const out = [`@${username}`, profileUrl, "", ...lines].join("\n").slice(0, 2000);
    copyText(out, "Profile stats copied!");
  } catch {
    copyText(profileUrl, "Profile link copied!");
  }
}

/* ---------------- profile edit form: native power, zero boxes ----------------
   The old helper box is gone (user asked to remove it). Power now lives
   INSIDE Instagram's own form: subtle inline counters under bio/username
   that look native and never shift layout. */

function enhanceEditPage() {
  // Kill any leftover box from older versions, then go native.
  document.querySelector("#inta-edit-helper")?.remove();
  document.documentElement.classList.remove("inta-editing");
  if (!settings.profileTools) return;
  if (!isProfileEditForm()) return;
  addInlineCounters();
}

const INTA_LIMITS = [
  { max: 150, find: () => findBioField() },
  { max: 30, find: () => findUsernameField() },
];

function addInlineCounters() {
  for (const { max, find } of INTA_LIMITS) {
    let field = null;
    try {
      field = find();
    } catch {}
    if (!field || field.dataset.intaCounted) continue;
    field.dataset.intaCounted = "1";
    const note = document.createElement("div");
    note.className = "inta-inline-count";
    field.after(note);
    const update = () => {
      const len = (field.value || "").length;
      note.textContent = `${len}/${max}`;
      note.classList.toggle("inta-over", len > max);
    };
    field.addEventListener("input", update);
    update();
  }
}

function findBioField() {
  return (
    document.querySelector("textarea[aria-label*='bio' i], textarea[name*='bio' i]") ||
    [...document.querySelectorAll("main textarea")].sort((a, b) => b.value.length - a.value.length)[0] ||
    null
  );
}

function findUsernameField() {
  return (
    document.querySelector("input[aria-label*='username' i], input[name*='username' i]") ||
    [...document.querySelectorAll("main input[type='text']")].find((i) =>
      /username/i.test(i.getAttribute("aria-label") || i.name || "")) ||
    null
  );
}

/* ---------------- LINKS IN BIO (mobile-only on desktop) ----------------
   Instagram desktop shows "Editing your links is only available on mobile".
   We bring that editor to desktop: read bio_links via current_user, then
   add/update via update_bio_links and delete via remove_bio_links —
   the same endpoints the mobile app uses (cookie auth, no app needed). */

function enhanceLinksEditor() {
  if (!settings.profileTools) return;
  if (!isProfileEditForm()) return;
  if (document.querySelector("#inta-links-btn")) return;
  const anchor = findLinksNotice();
  if (!anchor) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "inta-links-btn";
  btn.innerHTML = ic("link") + "<span>Edit links on desktop</span>";
  btn.title = "Add, edit or remove your bio links (mobile-only on Instagram web)";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openLinksModal();
  });
  anchor.after(btn);
}

// Find the "only available on mobile" notice IG renders in the Links row.
function findLinksNotice() {
  try {
    const main = document.querySelector("main");
    if (!main) return null;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let node = null;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || "").toLowerCase();
      if (t.includes("only available on mobile") && t.includes("link")) {
        // Climb to a block-level row container (stop before main).
        let el = node.parentElement;
        let guard = 0;
        while (el && el !== main && guard < 6) {
          const tag = el.tagName;
          if (/^(SECTION|DIV|LI|FORM)$/.test(tag) && el.getBoundingClientRect().width > 200) {
            // Prefer the smallest such container holding the notice.
            const inner = el.textContent || "";
            if (inner.length < 600) break;
          }
          el = el.parentElement;
          guard += 1;
        }
        return el && el !== main ? el : node.parentElement;
      }
    }
  } catch {}
  return null;
}

/* ----- Instagram bio-links API (web session, same as search.js auth) ----- */

function igCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}

// ds_user_id cookie IS the logged-in account id — no API call needed.
function igUidFromCookie() {
  const m = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
  return m ? m[1] : null;
}

// Username when the edit form has no value yet: profile URL, else
// document title ("user • Instagram photos and videos").
function usernameFromPage() {
  try {
    const m = location.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
    if (m && !RESERVED.has(m[1].toLowerCase())) return m[1];
    const t = (document.title || "").split("•")[0].trim().replace(/^@/, "");
    if (/^[A-Za-z0-9._]{1,30}$/.test(t) && !RESERVED.has(t.toLowerCase())) return t;
  } catch {}
  return "";
}

function igApiHeaders(form) {
  const h = {
    "x-ig-app-id": IG_APP_ID,
    "x-requested-with": "XMLHttpRequest",
    "x-csrftoken": igCsrf(),
  };
  if (form) h["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  return h;
}

function igUuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function igReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function igServerReason(res, data) {
  const msg = data?.message || data?.error_message || "";
  return `HTTP ${res.status}${msg ? " — " + String(msg).slice(0, 120) : ""}`;
}

// Read own bio links. The private current_user endpoint 400s from some
// web sessions (that HTTP 400 in your console is Instagram refusing the
// private read — NOT a login problem), so we fall back: public
// profile-info endpoint, then cookie-uid manual mode (existing links are
// kept, you can still add new ones). Returns { uid, links, via, partial }.
async function igReadBioLinks() {
  const problems = [];
  for (const url of [
    "https://www.instagram.com/api/v1/accounts/current_user/?edit=true",
    "https://www.instagram.com/api/v1/accounts/current_user/",
  ]) {
    try {
      const res = await fetch(url, { credentials: "include", headers: igApiHeaders(false) });
      const data = await igReadJson(res);
      const user = data?.user;
      if (res.ok && user) {
        return {
          uid: user.pk ?? user.pk_id ?? user.id ?? null,
          links: Array.isArray(user.bio_links) ? user.bio_links : [],
          via: "account",
          partial: false,
        };
      }
      problems.push(igServerReason(res, data));
    } catch (e) {
      problems.push(String(e?.message || e));
    }
  }
  // Fallback 1: public profile-info (same auth as our working search calls).
  // Username from the edit form, else from the page URL, else page title.
  const me =
    findUsernameField()?.value?.trim() ||
    usernameFromPage() ||
    "";
  if (me) {
    try {
      const res = await fetch(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(me),
        { credentials: "include", headers: igApiHeaders(false) }
      );
      const data = await igReadJson(res);
      const user = data?.data?.user;
      if (res.ok && user) {
        return {
          uid: user.id ?? user.pk ?? null,
          links: Array.isArray(user.bio_links) ? user.bio_links : [],
          via: "profile",
          partial: false,
        };
      }
      problems.push(igServerReason(res, data));
    } catch (e) {
      problems.push(String(e?.message || e));
    }
  } else {
    problems.push("no-username-found");
  }
  // Fallback 2 (NEW): uid straight from the ds_user_id cookie. Save calls
  // only need uid — so even when Instagram blocks BOTH reads, the editor
  // still opens in manual mode and adding links works. Existing links are
  // never deleted unless you remove their rows (toRemove is empty here).
  const cookieUid = igUidFromCookie();
  if (cookieUid) {
    return { uid: cookieUid, links: [], via: "manual", partial: true, problems };
  }
  throw new Error(problems.filter(Boolean).join(" | ") || "all-reads-failed");
}

async function igRemoveBioLinks(uid, uuid, linkIds) {
  const body = new URLSearchParams({
    _uid: String(uid),
    _uuid: uuid,
    link_ids: JSON.stringify(linkIds),
    _csrftoken: igCsrf(),
  });
  const res = await fetch("https://www.instagram.com/api/v1/accounts/remove_bio_links/", {
    method: "POST",
    credentials: "include",
    headers: igApiHeaders(true),
    body,
  });
  const data = await igReadJson(res);
  if (!res.ok || data?.status === "fail") throw new Error(igServerReason(res, data));
  return data;
}

async function igUpdateBioLinks(uid, uuid, links) {
  // Mirror the mobile client: updated_links is a JSON *string* of
  // [{url, title, link_type}] inside the form payload.
  const body = new URLSearchParams({
    _uid: String(uid),
    _uuid: uuid,
    updated_links: JSON.stringify(links),
    _csrftoken: igCsrf(),
  });
  const res = await fetch("https://www.instagram.com/api/v1/accounts/update_bio_links/", {
    method: "POST",
    credentials: "include",
    headers: igApiHeaders(true),
    body,
  });
  const data = await igReadJson(res);
  if (!res.ok || data?.status === "fail") throw new Error(igServerReason(res, data));
  return data;
}

function normalizeLinkUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/* ----- links modal ----- */

function openLinksModal() {
  closeLinksModal();
  const wrap = document.createElement("div");
  wrap.id = "inta-links-modal";
  wrap.innerHTML = `
    <div class="inta-links-backdrop" data-lclose="1"></div>
    <div class="inta-links-card" role="dialog" aria-label="Edit bio links">
      <div class="inta-links-head">
        <span class="inta-links-title">${ic("link")}<span>Links in bio</span></span>
        <button type="button" data-lact="close" aria-label="Close">${ic("x", 15)}</button>
      </div>
      <div class="inta-links-sub">Same editor the app has — works on desktop.</div>
      <div class="inta-links-list"></div>
      <button type="button" class="inta-links-add" data-lact="add">${ic("plus", 14)}<span>Add link</span></button>
      <div class="inta-links-status" aria-live="polite"></div>
      <div class="inta-links-foot">
        <button type="button" data-lact="close">Cancel</button>
        <button type="button" class="primary" data-lact="save">Save links</button>
      </div>
    </div>`;
  document.documentElement.appendChild(wrap);

  const list = wrap.querySelector(".inta-links-list");
  const status = wrap.querySelector(".inta-links-status");
  let uid = null;
  const uuid = igUuid();
  let existing = [];
  let saving = false;

  const setStatus = (msg, isErr) => {
    status.textContent = msg || "";
    status.classList.toggle("err", !!isErr);
  };

  const rowCount = () => list.querySelectorAll(".inta-link-row").length;

  function addRow(link) {
    if (rowCount() >= MAX_BIO_LINKS) {
      setStatus(`Instagram allows up to ${MAX_BIO_LINKS} links.`, true);
      return;
    }
    const row = document.createElement("div");
    row.className = "inta-link-row";
    if (link?.link_id != null) row.dataset.linkId = String(link.link_id);
    row.innerHTML = `
      <input type="text" class="inta-link-title" placeholder="Title (optional)" maxlength="60" />
      <input type="text" class="inta-link-url" placeholder="https://example.com" inputmode="url" />
      <button type="button" class="inta-link-del" title="Remove this link">${ic("trash", 15)}</button>`;
    if (link?.title) row.querySelector(".inta-link-title").value = link.title;
    if (link?.url) row.querySelector(".inta-link-url").value = link.url;
    row.querySelector(".inta-link-del").addEventListener("click", () => {
      row.remove();
      setStatus("");
    });
    list.appendChild(row);
  }

  async function load() {
    setStatus("Loading your links…");
    try {
      const data = await igReadBioLinks();
      uid = data.uid;
      existing = data.links;
      if (!uid) throw new Error("not-logged-in");
      if (data.partial) {
        // Instagram blocked the preload but uid is known: manual mode.
        // Existing links stay untouched (toRemove stays empty).
        setStatus("Instagram blocked the preview read — add new links below; your current ones stay safe.");
        addRow(null);
        return;
      }
      if (!existing.length) {
        setStatus(data.via === "profile" ? "No links found — add your first one below." : "No links yet — add your first one below.");
        addRow(null);
      } else {
        setStatus("");
        existing.forEach(addRow);
      }
    } catch (err) {
      console.warn("[Inta-Enhancer] links load failed", err);
      setStatus("Couldn't load links (Instagram blocked the read). Reload the page and try again.", true);
      if (rowCount() === 0) addRow(null);
    }
  }

  async function save() {
    if (saving) return;
    // Gather + validate.
    const desired = [];
    let bad = false;
    list.querySelectorAll(".inta-link-row").forEach((row) => {
      const title = row.querySelector(".inta-link-title").value.trim().slice(0, 60);
      const rawUrl = row.querySelector(".inta-link-url").value;
      if (!rawUrl.trim() && !title) return; // skip blank rows
      const url = normalizeLinkUrl(rawUrl);
      if (!url) {
        row.querySelector(".inta-link-url").classList.add("inta-bad");
        bad = true;
        return;
      }
      row.querySelector(".inta-link-url").classList.remove("inta-bad");
      desired.push({ link_id: row.dataset.linkId || null, url, title });
    });
    if (bad) {
      setStatus("Fix the highlighted URL first.", true);
      return;
    }
    if (!uid) {
      setStatus("Couldn't verify your account — reload Instagram and try again.", true);
      return;
    }
    saving = true;
    setStatus("Saving…");
    try {
      const existingIds = new Set(existing.map((l) => String(l.link_id)));
      const desiredIds = new Set(desired.map((d) => d.link_id).filter(Boolean));
      const toRemove = [...existingIds].filter((id) => !desiredIds.has(id));
      // updated_links carries no link_id (mobile client matches by URL).
      const toUpsert = desired.map((d) => ({
        url: d.url,
        title: d.title || "",
        link_type: "external",
      }));
      if (toRemove.length) await igRemoveBioLinks(uid, uuid, toRemove);
      if (toUpsert.length) await igUpdateBioLinks(uid, uuid, toUpsert);
      // Verify against a fresh read. The read endpoints can 400 even
      // right after a successful save — so a blocked verify must NOT
      // report failure when the writes themselves succeeded.
      try {
        const fresh = await igReadBioLinks();
        const freshLinks = Array.isArray(fresh?.links) ? fresh.links : [];
        if (!fresh.partial) {
          const freshUrls = new Set(
            freshLinks.map((l) => String(l.url || "").replace(/\/$/, ""))
          );
          const wantUrls = new Set(desired.map((d) => d.url.replace(/\/$/, "")));
          const missing = [...wantUrls].filter((u) => !freshUrls.has(u));
          existing = freshLinks;
          if (missing.length) {
            setStatus(`Saved, but Instagram didn't return: ${missing.slice(0, 2).join(", ")} — check your profile.`, true);
            return;
          }
        }
      } catch {
        /* blocked verify — fall through to success since writes succeeded */
      }
      // Writes succeeded (a blocked verify read falls through here too).
      setStatus("");
      toast("Links saved! Reload your profile to see them.");
      closeLinksModal();
    } catch (err) {
      console.warn("[Inta-Enhancer] links save failed", err);
      setStatus(`Save failed: ${String(err?.message || err).slice(0, 160)}`, true);
    } finally {
      saving = false;
    }
  }

  wrap.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-lclose]")) {
      closeLinksModal();
      return;
    }
    const btn = e.target.closest?.("[data-lact]");
    if (!btn) return;
    const act = btn.dataset.lact;
    if (act === "close") closeLinksModal();
    else if (act === "add") {
      setStatus("");
      addRow(null);
      list.querySelector(".inta-link-row:last-child .inta-link-url")?.focus();
    } else if (act === "save") save();
  });
  document.addEventListener("keydown", linksModalKey, true);

  load();
}

function linksModalKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeLinksModal();
  }
}

function closeLinksModal() {
  document.querySelector("#inta-links-modal")?.remove();
  document.removeEventListener("keydown", linksModalKey, true);
}

/* Mobile top search bar (Explore/Home/Reels have no top bar on desktop).
   Mobile always shows search on top — we add the same pill. Tapping it
   opens Instagram's own search drawer; we never touch video src/quality. */
function enhanceTopSearch() {
  if (!settings.mobileMode && !settings.profileTools) return;
  const p = pathName();
  const allow = p === "/" || p.startsWith("/explore") || p.startsWith("/reels") || p.startsWith("/reel");
  if (!allow) return;
  const main = document.querySelector("main");
  if (!main || document.querySelector("#inta-top-search")) return;
  // Don't duplicate if IG already shows a top search input here.
  const hasTopInput = [...main.querySelectorAll("input")].some((i) =>
    /search/i.test(i.placeholder || i.getAttribute("aria-label") || ""));
  if (hasTopInput) return;
  const bar = document.createElement("div");
  bar.id = "inta-top-search";
  bar.innerHTML = `<button type="button" data-tact="open"><span class="inta-top-ic">${ic("search")}</span><span>Search</span></button><button type="button" data-tact="create" title="New post or reel (Instagram composer)">${ic("plus", 18)}</button>`;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tact]");
    if (!btn) return;
    // ＋ opens Instagram's OWN composer (posts + reels upload work on
    // desktop) — same sheet the mobile app opens, zero hacks.
    if (btn.dataset.tact === "create") {
      try {
        if (typeof window.IntaOpenCreate === "function" && window.IntaOpenCreate() !== false) return;
      } catch {}
      toast("Tap ＋ Create in the left menu");
      return;
    }
    // Open IG's OWN search drawer — never navigate to /search or
    // /explore/search/ (those are dead ends on desktop).
    try {
      if (typeof window.IntaOpenSearch === "function") {
        const ok = window.IntaOpenSearch("");
        if (ok !== false) return;
      }
      const nav = [...document.querySelectorAll('nav a, nav div[role="link"], nav div[role="button"]')]
        .find((el) => (el.getAttribute("aria-label") || "").toLowerCase() === "search" && el.offsetParent !== null);
      if (nav) {
        nav.click();
        return;
      }
      toast("Tap Search in the left menu");
    } catch {}
  });
  main.prepend(bar);
}

/* ---------------- reels / video pages ---------------- */

function enhanceReelsPage() {
  // ZERO footprint inside reel frames: no children, no positioning, no
  // classes on holders (touching them broke layout/clicks). One floating
  // ⋯ menu lives OUTSIDE the frame (viewport bottom-left), acting on the
  // reel currently on screen. Articles keep their own inline menus.
  try {
    document.querySelectorAll(".inta-menu-wrap").forEach((w) => {
      try {
        const holder = w.parentElement;
        const inArticle = holder && holder.closest && holder.closest("article");
        if (!inArticle) w.remove(); // reels-holder menu from older builds
      } catch {}
    });
    document.querySelectorAll(".inta-reel-dl, .inta-reel-mp3").forEach((b) => {
      try { b.remove(); } catch {}
    });
    document.querySelectorAll(".inta-lefty").forEach((el) => {
      try { el.classList.remove("inta-lefty"); } catch {}
    });
  } catch {}
  updateFloatingReelMenu();
}

function isReelRoute() {
  try {
    const p = pathName();
    return p.startsWith("/reel") || p.startsWith("/reels");
  } catch { return false; }
}

function currentReelVideo() {
  try {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const v = el?.closest?.("video") || el?.querySelector?.("video") || findCenterVideo();
    return v || null;
  } catch { return null; }
}

function updateFloatingReelMenu() {
  try {
    let dock = document.getElementById("inta-reel-menu");
    if (!isReelRoute() || !settings.downloadBtn) {
      if (dock) dock.style.display = "none";
      return;
    }
    bindMenuDismiss();
    if (!dock || !dock.isConnected) {
      const old = document.getElementById("inta-reel-menu");
      if (old) { try { old.remove(); } catch {} }
      dock = document.createElement("div");
      dock.id = "inta-reel-menu";
      try { dock.style.display = "none"; } catch {}
      const btn = document.createElement("button");
      btn.className = "inta-menu";
      btn.type = "button";
      btn.textContent = "•••";
      btn.title = "Reel actions (Inta-Enhancer)";
      btn.setAttribute("aria-label", "Reel actions");
      swallowToggle(btn);
      const pop = document.createElement("div");
      pop.className = "inta-menu-pop";
      try { pop.classList.add("inta-reel-pop"); } catch {}
      pop.setAttribute("role", "menu");
      try { pop.style.display = "none"; } catch {}
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const was = pop.classList.contains("open");
        closeAllMenus(null);
        try { document.querySelectorAll(".inta-menu-pop").forEach((p) => { p.style.display = "none"; }); } catch {}
        if (!was) {
          pop.classList.add("open");
          try { pop.style.display = "block"; } catch {}
        }
      });
      pop.appendChild(menuRow("download", "Download", async () => {
        toast("Finding video…");
        const v = currentReelVideo();
        const r = await resolveDownloadUrl(v);
        if (!r.url) return toast("Video still loading — wait a second");
        downloadUrl(r.url, `insta-reel-${Date.now()}.mp4`);
      }));
      pop.appendChild(menuRow("music", "Audio MP3", () => {
        const v = currentReelVideo();
        if (!v) return toast("Video still loading — wait a second");
        downloadMp3FromElement(v);
      }));
      pop.appendChild(menuRow("link", "Copy link", () => {
        copyText(location.href, "Reel link copied!");
      }));
      dock.appendChild(btn);
      dock.appendChild(pop);
      document.documentElement.appendChild(dock);
    }
    dock.style.display = "block";
  } catch {}
}

/* ---------------- fullscreen + PiP ---------------- */

function fullscreenVisibleMedia() {
  const m = getVisibleMedia();
  if (!m) return toast("Scroll to a photo/reel first");
  try {
    if (m.el.requestFullscreen) m.el.requestFullscreen().catch(() => toast("Fullscreen blocked"));
    else if (m.el.closest("article")?.requestFullscreen)
      m.el.closest("article").requestFullscreen().catch(() => toast("Fullscreen blocked"));
    else toast("Fullscreen not supported");
  } catch {
    toast("Fullscreen blocked");
  }
}

function pipVisibleVideo() {
  const v =
    document
      .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      ?.closest?.("video") || findCenterVideo();
  if (!v) return toast("Scroll to a reel/video first");
  try {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
      return;
    }
    if (v.requestPictureInPicture) v.requestPictureInPicture().catch(() => toast("PiP blocked for this video"));
    else toast("PiP not supported");
  } catch {
    toast("PiP blocked for this video");
  }
}

/* ---------------- theme / wide ---------------- */

function applyTheme() {
  document.documentElement.classList.toggle("inta-dark", !!settings.darkMode);
}

function applyWideFeed() {
  document.documentElement.classList.toggle("inta-wide", !!settings.wideFeed);
}

/* Mobile feel: UA spoof (background.js) does the heavy lifting so IG
   itself serves the mobile-appropriate experience. We deliberately do NOT
   force narrow widths here — constraining main/header broke profile grids
   and settings sidebars (scrambled pages). This class is only a hook for
   small safe touches + our own pills. */
function applyMobileFrame() {
  const on = !!settings.mobileMode;
  document.documentElement.classList.toggle("inta-mobile", on);
  try {
    let meta = document.querySelector('meta[name="viewport"]');
    if (on && !meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1";
      document.head.appendChild(meta);
    }
  } catch {}
}

/* ---------------- zoom lens ---------------- */

function createZoomLens() {
  if (lens) return;
  lens = document.createElement("div");
  lens.id = "inta-lens";
  lens.style.display = "none";
  document.documentElement.appendChild(lens);
  if (lensBound) return;
  lensBound = true;

  let raf = 0;
  let lastEvt = null;
  document.addEventListener(
    "mousemove",
    (e) => {
      lastEvt = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          if (!settings.zoomHover || !lens) {
            if (lens) lens.style.display = "none";
            return;
          }
          const t = lastEvt?.target;
          if (
            t?.tagName === "IMG" &&
            t.naturalWidth > 200 &&
            t.closest?.("article, main") &&
            t.src
          ) {
            lens.style.display = "block";
            lens.style.backgroundImage = `url("${pickBestSrc(t)}")`;
            lens.style.left = lastEvt.pageX + 20 + "px";
            lens.style.top = lastEvt.pageY + 20 + "px";
          } else {
            lens.style.display = "none";
          }
        } catch {
          /* never break page */
        }
      });
    },
    { passive: true }
  );
  document.addEventListener("scroll", () => {
    if (lens) lens.style.display = "none";
  }, { passive: true, capture: true });
}

/* ---------------- shortcuts ---------------- */

function bindShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t?.matches?.("input, textarea, select, [contenteditable], [role='textbox']")) return;
    const key = (e.key || "").toLowerCase();
    if (key === "d") downloadVisibleMedia();
    else if (key === "c") copyVisibleCaption();
    else if (key === "f") fullscreenVisibleMedia();
    else if (key === "p") pipVisibleVideo();
  });
}

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg) {
  try {
    let el = document.getElementById("inta-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "inta-toast";
      // Inline critical look: visible even if content.css ever fails.
      try {
        el.style.cssText = "position:fixed;left:50%;bottom:30px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;z-index:1000000;max-width:90vw;text-align:center;font-family:sans-serif;";
      } catch {}
      document.documentElement.appendChild(el);
    }
    el.textContent = String(msg);
    el.classList.add("show");
    try { el.style.opacity = "1"; } catch {}
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      try { el.classList.remove("show"); el.style.opacity = "0"; } catch {}
    }, 2200);
  } catch {}
}
})();
