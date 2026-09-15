/* ============================================================
   Inta-Enhancer - power.js v1.0 (OLIN 1.1.b power pack)
   Advanced, guarded, zero-dependency. Runs after content.js.
   Features: story saver, reels toolkit, ghost mode, Cmd-K
   palette, stats history, bulk saver, hashtag tools.
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
  storySaver: true,
  reelsToolkit: true,
  ghostMode: false,
  cmdPalette: true,
  statsHistory: true,
  bulkSaver: true,
  hashtagTools: true,
  centerStage: true,  // center stories tray contents (safe center)
  quickCreate: true,  // N key + palette + top-bar ＋ open IG composer
  dataSaver: false,   // no autoplay: videos play only when you tap them
  autoUnmute: true,   // reels stop starting muted on every scroll
  reelRedirect: false,// explore-clicked reels auto-open as fullscreen reel view
  clickOpensReel: true, // clicking a reel video opens it instead of pausing
};

let S = { ...DEFAULTS };
let paletteOpen = false;
let bulkBtn = null;

init().catch((e) => console.warn("[Inta-Power] init failed", e));

async function init() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    S = { ...DEFAULTS, ...stored };
  } catch {}
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== "sync") return;
      for (const k in c) if (k in S) S[k] = c[k].newValue;
      applyGhost();
    });
  } catch {}

  applyGhost();
  bindPaletteKeys();
  bindClickOpensReel();

  setInterval(tick, 1500);
  tick();
  console.log("[Inta-Power] OLIN 1.1.b loaded");
}

function tick() {
  try {
    if (document.hidden) return;
    if (S.storySaver) storySaverTick();
    if (S.reelsToolkit) reelsTick();
    if (S.statsHistory) statsTick();
    if (S.bulkSaver) bulkTick();
    if (S.hashtagTools) hashtagTick();
    if (S.centerStage) centerStageTick();
    if (S.quickCreate) linkTick();
    if (S.dataSaver) dataSaverTick();
    if (S.autoUnmute) autoUnmuteTick();
    reelDialogTick();
    activityTick();
  } catch (e) {
    console.warn("[Inta-Power] tick failed", e);
  }
}

/* ---------------- toast (shared look) ---------------- */
let toastTimer = null;
function toast(msg) {
  try {
    let el = document.getElementById("inta-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "inta-toast";
      document.documentElement.appendChild(el);
    }
    el.textContent = String(msg);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  } catch {}
}

function downloadUrl(url, filename) {
  if (!url || url.startsWith("blob:")) return toast("Media still loading — wait a sec");
  try {
    chrome.runtime.sendMessage({ type: "INTA_DOWNLOAD", url, filename }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) toast("Download blocked — right-click > Save");
      else toast("Downloading…");
    });
  } catch { toast("Download unavailable"); }
}

/* ---------------- 1. Story saver ----------------
   Stories viewer = full-screen dialog with video/img.
   We add a native save badge on the viewer (works for stories,
   highlights, reels viewer). Never touches nav. */
function storySaverTick() {
  const isStory = /\/stories\//.test(location.pathname);
  const dlg = document.querySelector('div[role="dialog"]');
  if (!dlg && !isStory) return;
  const scope = dlg || document;
  // find the biggest visible media in viewer
  const videos = [...scope.querySelectorAll("video")].filter((v) => {
    try { const r = v.getBoundingClientRect(); return r.width > 200 && r.height > 200; } catch { return false; }
  });
  const imgs = [...scope.querySelectorAll("img")].filter((i) => {
    try { const r = i.getBoundingClientRect(); return r.width > 250 && r.height > 250 && i.naturalWidth > 400; } catch { return false; }
  });
  const target = videos[0] || imgs[0];
  if (!target) return;
  const holder = target.parentElement;
  if (!holder || holder.querySelector(":scope > .inta-story-dl")) return;
  try { if (getComputedStyle(holder).position === "static") holder.style.position = "relative"; } catch {}
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "inta-story-dl";
  btn.innerHTML = ic("download", 15) + "<span>Save</span>";
  btn.title = "Save this story (Inta-Enhancer)";
  btn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (target.tagName === "VIDEO") {
      const url = target.currentSrc || target.src || "";
      if (!url) return toast("Video still loading");
      downloadUrl(url, `insta-story-${Date.now()}.mp4`);
    } else {
      const url = target.currentSrc || target.src || "";
      if (!url) return toast("Image still loading");
      downloadUrl(url, `insta-story-${Date.now()}.jpg`);
    }
  });
  holder.appendChild(btn);
}

/* ---------------- 2. Reels toolkit ----------------
   Speed (1x/1.25/1.5/2x), loop toggle, auto-next, copy link.
   Tiny bar under each main video, desktop-only. */
const reelState = new WeakMap();
function reelsTick() {
  if (!location.pathname.startsWith("/reel") && !location.pathname.startsWith("/reels")) return;
  document.querySelectorAll("main video").forEach((video) => {
    const holder = video.closest("div") || video.parentElement;
    if (!holder || holder.querySelector(":scope > .inta-reel-bar")) return;
    const st = { speed: 1, loop: video.loop || false, auto: false };
    reelState.set(video, st);
    try { if (getComputedStyle(holder).position === "static") holder.style.position = "relative"; } catch {}
    const bar = document.createElement("div");
    bar.className = "inta-reel-bar";
    bar.innerHTML = `
      <button type="button" data-r="speed" title="Playback speed">1×</button>
      <button type="button" data-r="loop" title="Loop on/off">${ic("repeat", 14)}</button>
      <button type="button" data-r="mute" title="Mute/unmute">${ic("volume", 14)}</button>
      <button type="button" data-r="auto" title="Auto-next reel">${ic("next", 14)}</button>
      <button type="button" data-r="link" title="Copy reel link">${ic("link", 14)}</button>`;
    bar.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-r]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const act = b.dataset.r;
      if (act === "speed") {
        const steps = [1, 1.25, 1.5, 2];
        st.speed = steps[(steps.indexOf(st.speed) + 1) % steps.length] || 1;
        try { video.playbackRate = st.speed; } catch {}
        b.textContent = String(st.speed).replace(/\.0$/, "") + "×";
        b.classList.add("on");
        toast(`Speed ${b.textContent}`);
      }
      if (act === "loop") {
        st.loop = !st.loop;
        try { video.loop = st.loop; } catch {}
        b.classList.toggle("on", st.loop);
        toast(st.loop ? "Loop ON" : "Loop OFF");
      }
      if (act === "mute") {
        try { video.muted = !video.muted; } catch {}
        try { video.dataset.intaUserMuted = video.muted ? "1" : ""; } catch {}
        b.classList.toggle("on", !!video.muted);
        toast(video.muted ? "Muted" : "Sound on");
      }
      if (act === "auto") {
        st.auto = !st.auto;
        b.classList.toggle("on", st.auto);
        toast(st.auto ? "Auto-next ON" : "Auto-next OFF");
        if (st.auto) armAutoNext(video);
      }
      if (act === "link") {
        copyText(location.href, "Reel link copied!");
      }
    });
    video.addEventListener("ended", () => {
      const s = reelState.get(video);
      if (s?.auto) nextReel();
    });
    try {
      bar.querySelector('[data-r="mute"]')?.classList.toggle("on", !!video.muted);
    } catch {}
    holder.appendChild(bar);
  });
}

function nextReel() {
  try {
    // next reel = scroll one viewport down inside reels feed
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
  } catch {}
}

function armAutoNext(video) {
  try {
    if (video.dataset.intaAuto) return;
    video.dataset.intaAuto = "1";
    video.addEventListener("ended", () => {
      const s = reelState.get(video);
      if (s?.auto) setTimeout(nextReel, 400);
    });
  } catch {}
}

/* ---------------- 3. Ghost mode ----------------
   Distraction-free + privacy-lite: hides stories tray,
   suggested posts, autoplay mutes to click-to-play.
   (True "hide seen" needs network blocking per-account
   and breaks DMs — deliberately not faked.) */
function applyGhost() {
  document.documentElement.classList.toggle("inta-ghost", !!S.ghostMode);
}

/* ---------------- 4. Command palette (Ctrl+K) ---------------- */
function bindPaletteKeys() {
  document.addEventListener("keydown", (e) => {
    try {
      const typing = e.target?.matches?.("input, textarea, select, [contenteditable], [role='textbox'], [data-meta-input]");
      if ((e.ctrlKey || e.metaKey) && (e.key || "").toLowerCase() === "k") {
        e.preventDefault();
        if (!S.cmdPalette) return toast("Enable Command palette in popup");
        togglePalette();
        return;
      }
      if (paletteOpen && e.key === "Escape") { closePalette(); return; }
      if (typing) return;
      // N = new post / reel (same single-key style as D/C/F/P in content.js)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key || "").toLowerCase() === "n") {
        if (!S.quickCreate) return;
        if (paletteOpen) closePalette();
        try { window.IntaOpenCreate?.(); } catch {}
        return;
      }
    } catch {}
  });
}

const ACTIONS = [
  { id: "dl", icon: "download", label: "Download visible media", hint: "D", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" })) },
  { id: "cap", icon: "copy", label: "Copy caption", hint: "C", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" })) },
  { id: "full", icon: "expand", label: "Fullscreen visible", hint: "F", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })) },
  { id: "pip", icon: "image", label: "Picture-in-picture", hint: "P", run: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" })) },
  { id: "search", icon: "search", label: "Open search", run: () => { try { window.IntaOpenSearch?.(""); } catch {} } },
  { id: "create", icon: "plus", label: "New post / reel", hint: "N", run: () => { try { window.IntaOpenCreate?.(); } catch {} } },
  { id: "story", icon: "camera", label: "Story studio (compose 9:16)", run: () => { try { window.IntaOpenStory?.(); } catch {} } },
  { id: "hd", icon: "user", label: "View HD profile pic", run: () => toast("Open a profile, then press HD") },
  { id: "explore", icon: "compass", label: "Go Explore", run: () => location.href = "https://www.instagram.com/explore/" },
  { id: "reels", icon: "film", label: "Go Reels", run: () => location.href = "https://www.instagram.com/reels/" },
  { id: "edit", icon: "edit", label: "Edit profile", run: () => location.href = "https://www.instagram.com/accounts/edit/" },
  { id: "copydlink", icon: "link", label: "Copy current page link", run: () => copyText(location.href, "Link copied!") },
  { id: "settings", icon: "command", label: "All settings hub", run: () => { try { window.IntaOpenSettings?.(); } catch {} } },
  { id: "dark", icon: "moon", label: "Toggle dark mode", run: async () => {
      try {
        const s = await chrome.storage.sync.get({ darkMode: false });
        await chrome.storage.sync.set({ darkMode: !s.darkMode });
        toast(!s.darkMode ? "Dark ON" : "Dark OFF");
      } catch {}
    } },
];

function togglePalette() { paletteOpen ? closePalette() : openPalette(); }

function openPalette() {
  closePalette();
  paletteOpen = true;
  const ov = document.createElement("div");
  ov.id = "inta-palette";
  ov.innerHTML = `
    <div class="inta-pal-back" data-pal-close="1"></div>
    <div class="inta-pal-card" role="dialog" aria-label="Command palette">
      <input class="inta-pal-input" type="text" placeholder="Type a command… (Download, Search, Reels…)" aria-label="Commands" />
      <div class="inta-pal-list"></div>
      <div class="inta-pal-hint">Ctrl+K to close • ↑↓ + Enter</div>
    </div>`;
  document.documentElement.appendChild(ov);
  const input = ov.querySelector(".inta-pal-input");
  const list = ov.querySelector(".inta-pal-list");
  let sel = 0;
  let filtered = [...ACTIONS];

  function render() {
    list.innerHTML = "";
    filtered.forEach((a, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "inta-pal-row" + (i === sel ? " sel" : "");
      row.innerHTML = `${a.icon ? ic(a.icon, 16) : ""}<span>${escapeHtml(a.label)}</span>${a.hint ? `<kbd>${escapeHtml(a.hint)}</kbd>` : ""}`;
      row.addEventListener("click", () => { closePalette(); try { a.run(); } catch {} });
      row.addEventListener("mousemove", () => { sel = i; paint(); });
      list.appendChild(row);
    });
    if (!filtered.length) list.innerHTML = `<div class="inta-pal-empty">No match — try "reels"</div>`;
  }
  function paint() {
    [...list.children].forEach((el, i) => el.classList.toggle("sel", i === sel));
  }
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase().trim();
    filtered = ACTIONS.filter((a) => a.label.toLowerCase().includes(q));
    sel = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); paint(); }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    if (e.key === "Enter") { e.preventDefault(); const a = filtered[sel]; closePalette(); try { a?.run(); } catch {} }
  });
  ov.addEventListener("click", (e) => { if (e.target.closest?.("[data-pal-close]")) closePalette(); });
  render();
  setTimeout(() => { try { input.focus(); } catch {} }, 40);
}

function closePalette() {
  paletteOpen = false;
  try { document.getElementById("inta-palette")?.remove(); } catch {}
}

/* ---------------- 5. Stats history ----------------
   Snapshot profile counters (posts/followers/following) per visit
   into storage.local, show delta badge under our profile bar. */
function profileName() {
  const m = location.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  if (!m) return null;
  const reserved = new Set(["explore","reels","reel","p","stories","direct","inbox","accounts","settings"]);
  if (reserved.has(m[1].toLowerCase())) return null;
  return m[1];
}

function readCounters() {
  try {
    const header = document.querySelector("header");
    if (!header) return null;
    const nums = [...header.querySelectorAll("span, div, li, a")]
      .map((el) => (el.innerText || "").trim())
      .filter((t) => /^\d[\d,.KMB]*\s*(posts|followers|following)/i.test(t))
      .slice(0, 6);
    // parse "1,234 followers" style
    const out = {};
    for (const t of nums) {
      const m = t.match(/^([\d,.KMB]+)\s*(posts|followers|following)/i);
      if (!m) continue;
      out[m[2].toLowerCase()] = parseCount(m[1]);
    }
    return (out.followers != null) ? out : null;
  } catch { return null; }
}

function parseCount(s) {
  s = String(s).toUpperCase().replace(/,/g, "");
  const mult = s.endsWith("K") ? 1e3 : s.endsWith("M") ? 1e6 : s.endsWith("B") ? 1e9 : 1;
  const n = parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
  return Math.round(n * mult);
}

let statsDoneFor = "";
function statsTick() {
  const user = profileName();
  if (!user) return;
  if (statsDoneFor === user + location.href) return;
  const c = readCounters();
  if (!c) return;
  statsDoneFor = user + location.href;
  saveSnapshot(user, c);
}

async function saveSnapshot(user, c) {
  try {
    const key = "intaStats_" + user.toLowerCase();
    const store = await chrome.storage.local.get({ [key]: [] });
    const arr = Array.isArray(store[key]) ? store[key] : [];
    const last = arr[arr.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    if (last && last.d === today && last.followers === c.followers) { renderDelta(user, arr); return; }
    arr.push({ d: today, ...c });
    while (arr.length > 60) arr.shift();
    await chrome.storage.local.set({ [key]: arr });
    renderDelta(user, arr);
  } catch {}
}

async function renderDelta(user, arr) {
  try {
    if (!arr || arr.length < 2) return;
    const first = arr[0], last = arr[arr.length - 1];
    const diff = (last.followers || 0) - (first.followers || 0);
    if (!diff) return;
    const bar = document.querySelector("#inta-profile-bar");
    if (!bar || bar.querySelector(".inta-growth")) return;
    const chip = document.createElement("span");
    chip.className = "inta-growth";
    chip.title = `Followers ${first.followers?.toLocaleString()} → ${last.followers?.toLocaleString()} since ${first.d}`;
    chip.innerHTML = ic("trend", 13) + `<span>${diff > 0 ? "+" : ""}${diff.toLocaleString()} since ${first.d.slice(5)}</span>`;
    bar.appendChild(chip);
  } catch {}
}

/* ---------------- 6. Bulk saver ----------------
   Profile / tag / explore grids: one button saves up to 12
   visible full-res images via background queue. */
function bulkTick() {
  const p = location.pathname;
  const allow = /^\/[A-Za-z0-9._]+\/?$/.test(p) || p.startsWith("/explore") || p.startsWith("/reels");
  if (!allow && !p.startsWith("/explore/tags/")) {
    bulkBtn?.remove(); bulkBtn = null; return;
  }
  if (bulkBtn?.isConnected) return updateBulkLabel();
  const main = document.querySelector("main");
  if (!main) return;
  bulkBtn = document.createElement("button");
  bulkBtn.type = "button";
  bulkBtn.id = "inta-bulk";
  bulkBtn.title = "Download visible photos (up to 12)";
  bulkBtn.addEventListener("click", bulkSave);
  document.documentElement.appendChild(bulkBtn);
  updateBulkLabel();
}

function visibleGridImages() {
  const imgs = [...document.querySelectorAll("main img")].filter((i) => {
    try {
      const r = i.getBoundingClientRect();
      return r.width > 150 && r.height > 150 && i.naturalWidth > 300 && r.top > -200 && r.top < window.innerHeight + 200;
    } catch { return false; }
  });
  // dedupe by src, biggest first
  const seen = new Set();
  const out = [];
  imgs.sort((a, b) => b.naturalWidth - a.naturalWidth);
  for (const i of imgs) {
    const src = i.currentSrc || i.src;
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src.replace(/s\d+x\d+/g, "s1080x1080"));
    if (out.length >= 12) break;
  }
  return out;
}

function updateBulkLabel() {
  try {
    const n = visibleGridImages().length;
    if (bulkBtn) bulkBtn.innerHTML = ic("layers", 16) + `<span>Save visible (${n})</span>`;
  } catch {}
}

function bulkSave(e) {
  e.preventDefault(); e.stopPropagation();
  const urls = visibleGridImages();
  if (!urls.length) return toast("Scroll to a photo grid first");
  toast(`Saving ${urls.length} photos…`);
  try {
    chrome.runtime.sendMessage({
      type: "INTA_DOWNLOAD_MANY",
      items: urls.map((url, i) => ({ url, filename: `insta-bulk-${Date.now()}-${i + 1}.jpg` })),
    }, (res) => {
      if (chrome.runtime.lastError) return toast("Bulk blocked — try single download");
      toast(`Saved ${res?.downloaded ?? urls.length}/${urls.length}`);
    });
  } catch { toast("Bulk save unavailable"); }
}

/* ---------------- 7. Hashtag tools ----------------
   On posts: copy all #tags from caption in one tap. */
function hashtagTick() {
  document.querySelectorAll("article").forEach((a) => {
    if (a.querySelector(":scope > .inta-tags")) return;
    if (a.querySelector(":scope > .inta-menu-wrap")) return; // menu owns it
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "inta-tags";
    btn.innerHTML = ic("hash", 18);
    btn.title = "Copy hashtags (Inta-Enhancer)";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const text = (a.innerText || "").match(/#[\p{L}\p{N}_]+/gu);
      if (!text?.length) return toast("No hashtags here");
      copyText([...new Set(text)].join(" "), `${text.length} hashtags copied!`);
    });
    try { if (getComputedStyle(a).position === "static") a.style.position = "relative"; } catch {}
    a.appendChild(btn);
  });
}

/* ---------------- 8. Quick Create: post reels & posts like mobile ----------------
   Instagram desktop HAS an upload composer (the ＋ New post sheet —
   posts + reels). Programmatic upload APIs are private/mobile-encrypted
   and would risk the account, so we open IG's OWN composer: same sheet,
   same uploads as the app, zero hacks. Entry points: top-bar ＋ button
   (content.js), Ctrl+K palette, and the N key. */
window.IntaOpenCreate = function () {
  try {
    openComposer();
    return true;
  } catch {
    return false;
  }
};

// Every known shape of IG's Create entry (it renames often), tried in
// order with verification after each click. Returns nothing — the result
// is verified async via composerOpen() + user-facing toasts.
function openComposer() {
  if (composerOpen()) return;
  const cands = collectCreateCandidates();
  if (!cands.length) {
    composerFallback(null);
    return;
  }
  let i = 0;
  const tryNext = () => {
    try {
      if (composerOpen()) return;
      if (i >= cands.length) {
        composerFallback(cands[0]);
        return;
      }
      const el = cands[i++];
      try { el.click(); } catch {}
      setTimeout(tryNext, 900);
    } catch {}
  };
  tryNext();
}

function collectCreateCandidates() {
  const out = [];
  const seen = new Set();
  const push = (el) => {
    let t = null;
    try {
      t = el?.closest?.("a, div[role='link'], div[role='button'], button") || el;
    } catch { t = el; }
    if (!t || seen.has(t)) return;
    seen.add(t);
    try {
      if (t.offsetParent !== null) out.push(t);
    } catch {}
  };
  try {
    // 1. aria-label="New post" anywhere in nav (svg usually carries it)
    document.querySelectorAll("nav [aria-label], [role='navigation'] [aria-label]").forEach((el) => {
      if ((el.getAttribute("aria-label") || "").toLowerCase() === "new post") push(el);
    });
    const svg = document.querySelector('svg[aria-label="New post"]');
    if (svg) push(svg);
    // 2. title="New post" variant
    document.querySelectorAll("nav [title]").forEach((el) => {
      if ((el.getAttribute("title") || "").toLowerCase() === "new post") push(el);
    });
    // 3. own-text "Create" leaf in nav (text-node check, not innerText —
    // innerText matches whole subtrees and clicks the wrong node)
    document.querySelectorAll("nav span, nav div, nav a, nav button").forEach((el) => {
      try {
        const own = [...el.childNodes].some(
          (n) => n.nodeType === 3 && (n.nodeValue || "").trim().toLowerCase() === "create"
        );
        if (own) push(el);
      } catch {}
    });
  } catch {}
  return out;
}

// True once IG's composer sheet is on screen: "Create new post" /
// "Select from computer" dialog, or any file picker inside a dialog.
function composerOpen() {
  try {
    const dlgs = [...document.querySelectorAll('div[role="dialog"]')];
    for (const d of dlgs) {
      try {
        if (/create new post|select from computer|new reel|\bcrop\b/i.test(d.innerText || "")) return true;
        if (d.querySelector('input[type="file"]')) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

// Last resort: pulse the best guess so the user can tap it, or explain
// the one real blocker — our iPhone UA can make IG hide desktop Create.
function composerFallback(best) {
  try {
    document.querySelectorAll(".inta-create-hint").forEach((x) => {
      try { x.classList.remove("inta-create-hint"); } catch {}
    });
    if (composerOpen()) return;
    if (best && best.isConnected) {
      best.classList.add("inta-create-hint");
      setTimeout(() => { try { best.classList.remove("inta-create-hint"); } catch {} }, 6000);
      toast("Tap the highlighted ＋ Create button");
    } else {
      toast("IG is hiding Create — turn Mobile feel OFF in popup + reload, then tap ＋");
    }
  } catch {}
}

/* ---------------- 9. Center stage: stories tray centered ----------------
   Home tray contents hug the left edge leaving a void on wide screens.
   Old approach only matched *overflowing* scrollers — but the tray is
   often a full-width container with a left-hugging row inside (nothing
   overflows, so nothing matched). New approach: find the avatar ROW by
   content (5+ story-sized square images sharing one flex/grid track)
   and `safe center` it: centered when it fits, left-scrollable when it
   overflows (plain `center` would strand the left edge). Home only,
   throttled, one element, fully toggleable. */
let trayEl = null;
let lastTrayScan = 0;
function centerStageTick() {
  try {
    if (location.pathname !== "/") { trayEl = null; return; }
    if (trayEl?.isConnected) return;
    trayEl = null;
    const now = Date.now();
    if (now - lastTrayScan < 4000) return; // throttled: DOM scan is costly
    lastTrayScan = now;
    const main = document.querySelector("main");
    if (!main) return;
    // Story-sized square images actually laid out on screen.
    const imgs = [...main.querySelectorAll("img")].filter((i) => {
      try {
        if (i.closest("#inta-top-search, #inta-settings, #inta-palette")) return false;
        const r = i.getBoundingClientRect();
        return r.width >= 48 && r.width <= 140 && Math.abs(r.width - r.height) < 16 &&
          r.top >= -120 && r.top < window.innerHeight && r.width > 0;
      } catch { return false; }
    });
    if (imgs.length < 5) return;
    // Nearest ancestor containing most of them that lays out in flex/grid.
    // DEEPEST match wins: climbing to a high flex column (the whole feed)
    // would shift the entire page, so we take the closest row, not the
    // biggest container.
    let track = null;
    let bestDepth = Infinity;
    let bestCount = 0;
    const seen = new Set();
    for (const img of imgs) {
      let el = img.parentElement;
      let depth = 0;
      while (el && el !== main && depth < 8) {
        if (!seen.has(el)) {
          seen.add(el);
          let count = 0;
          try {
            for (const o of imgs) if (el.contains(o)) count++;
          } catch {}
          if (count >= 5) {
            try {
              const d = String(getComputedStyle(el).display || "");
              if ((d.includes("flex") || d.includes("grid")) &&
                  (depth < bestDepth || (depth === bestDepth && count > bestCount))) {
                bestDepth = depth;
                bestCount = count;
                track = el;
              }
            } catch {}
          }
        }
        el = el.parentElement;
        depth++;
      }
    }
    // Fallback: a horizontal scroller holding at least 3 of them.
    if (!track) {
      const scrollers = [...main.querySelectorAll("div")].filter((d) => {
        try {
          if (d.dataset.intaTray || d.closest("#inta-top-search")) return false;
          if (d.clientWidth < 300) return false;
          if (d.scrollWidth < d.clientWidth + 20) return false;
          return true;
        } catch { return false; }
      });
      for (const sc of scrollers) {
        let count = 0;
        try {
          for (const o of imgs) if (sc.contains(o)) count++;
        } catch {}
        if (count >= 3) {
          let inner = sc;
          for (const ch of sc.children) {
            try {
              if (ch.contains(imgs[0]) && String(getComputedStyle(ch).display || "").includes("flex")) {
                inner = ch;
                break;
              }
            } catch {}
          }
          track = inner;
          break;
        }
      }
    }
    if (track) {
      track.classList.add("inta-centered-tray");
      track.dataset.intaTray = "1";
      trayEl = track;
    }
  } catch {}
}

/* ---------------- 10. Per-post link copy (4th in the article stack) ---------------- */
function linkTick() {
  document.querySelectorAll("article").forEach((a) => {
    if (a.querySelector(":scope > .inta-linkcopy")) return;
    if (a.querySelector(":scope > .inta-menu-wrap")) return; // menu owns it
    const anchor = a.querySelector('a[href^="/p/"], a[href^="/reel/"], a[href*="/p/"], a[href*="/reel/"]');
    if (!anchor) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "inta-linkcopy";
    btn.innerHTML = ic("link", 17);
    btn.title = "Copy post link (Inta-Enhancer)";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const href = anchor.getAttribute("href") || location.href;
      copyText(href.startsWith("http") ? href : "https://www.instagram.com" + href, "Post link copied!");
    });
    try { if (getComputedStyle(a).position === "static") a.style.position = "relative"; } catch {}
    a.appendChild(btn);
  });
}

/* ---------------- 11. Settings Hub: mobile settings on PC ----------------
   Instagram hides many settings on PC web. The hub puts them in reach:
   deep links where a web page exists, and inline switches where the
   mobile app just calls an API (Private account = set_private /
   set_public, the same call the app makes — guarded with confirm +
   verify, like our links editor). Entry: Ctrl+K → All settings hub,
   or the popup button (via INTA_OPEN_SETTINGS message). */
window.IntaOpenSettings = function () {
  try {
    openSettingsHub();
    return true;
  } catch {
    return false;
  }
};

const ST_APP_ID = "936619743392459";

function stCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
function stHeaders(form) {
  const h = {
    "x-ig-app-id": ST_APP_ID,
    "x-requested-with": "XMLHttpRequest",
    "x-csrftoken": stCsrf(),
  };
  if (form) h["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8";
  return h;
}
function stUuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
async function stReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
function stUid() {
  const m = document.cookie.match(/(?:^|;\s*)ds_user_id=(\d+)/);
  return m ? m[1] : null;
}

// is_private via current_user, else public profile-info (same auth as search).
async function stReadPrivacy() {
  for (const url of [
    "https://www.instagram.com/api/v1/accounts/current_user/?edit=true",
    "https://www.instagram.com/api/v1/accounts/current_user/",
  ]) {
    try {
      const res = await fetch(url, { credentials: "include", headers: stHeaders(false) });
      const data = await stReadJson(res);
      if (res.ok && data?.user && typeof data.user.is_private === "boolean") {
        return { isPrivate: data.user.is_private, uid: String(data.user.pk ?? data.user.id ?? stUid() ?? "") };
      }
    } catch {}
  }
  return { isPrivate: null, uid: stUid() };
}

async function stSetPrivate(uid, makePrivate) {
  const body = new URLSearchParams({
    _uid: String(uid),
    _uuid: stUuid(),
    _csrftoken: stCsrf(),
  });
  const ep = makePrivate ? "set_private" : "set_public";
  const res = await fetch(`https://www.instagram.com/api/v1/accounts/${ep}/`, {
    method: "POST",
    credentials: "include",
    headers: stHeaders(true),
    body,
  });
  const data = await stReadJson(res);
  if (!res.ok || data?.status === "fail") {
    throw new Error(`HTTP ${res.status}`);
  }
  return data;
}

// "Coming soon" row: honest placeholder for features that need the
// native app engine. Tapping explains instead of pretending to work.
function soonRow(icon, title, sub, words) {
  return `<div class="inta-set-row inta-soon" data-words="${words}" data-soon="${title}">`
    + `${ic(icon)}<span><b>${title}</b><small>${sub}</small></span>`
    + `<span class="inta-soon-badge">Soon</span></div>`;
}

/* ----- Notes (read / post / delete) -----
   Endpoints confirmed across independent sources (instagrapi, direct
   traffic captures): GET notes/get_notes, POST notes/create_note
   {text, audience 0=followers-you-follow-back, 1=close friends},
   POST notes/delete_note {note_id}. 60 chars, human pace — notes are
   manual by nature, so no rate risk. Same web-session auth as our
   other app-mirroring calls; failures report honestly. */
async function ntGetMine() {
  try {
    const res = await fetch("https://www.instagram.com/api/v1/notes/get_notes/", {
      credentials: "include",
      headers: stHeaders(false),
    });
    const data = await stReadJson(res);
    if (!res.ok || !data) throw new Error(`HTTP ${res.status}`);
    const notes = Array.isArray(data.notes) ? data.notes : [];
    const me = stUid();
    const mine = notes.find((n) => {
      try {
        const pk = n?.user?.pk ?? n?.user?.id;
        return pk != null && String(pk) === String(me);
      } catch { return false; }
    }) || null;
    return { mine, count: notes.length };
  } catch (e) {
    throw new Error(String((e && e.message) || e));
  }
}

async function ntCreate(text, audience) {
  const body = new URLSearchParams({
    text: String(text || "").slice(0, 60),
    audience: audience === 1 ? "1" : "0",
    _uid: String(stUid() || ""),
    _uuid: stUuid(),
    _csrftoken: stCsrf(),
  });
  const res = await fetch("https://www.instagram.com/api/v1/notes/create_note/", {
    method: "POST",
    credentials: "include",
    headers: stHeaders(true),
    body,
  });
  const data = await stReadJson(res);
  if (!res.ok || data?.status === "fail") throw new Error(`HTTP ${res.status}`);
  return data;
}

async function ntDelete(noteId) {
  const body = new URLSearchParams({
    note_id: String(noteId),
    _uid: String(stUid() || ""),
    _uuid: stUuid(),
    _csrftoken: stCsrf(),
  });
  const res = await fetch("https://www.instagram.com/api/v1/notes/delete_note/", {
    method: "POST",
    credentials: "include",
    headers: stHeaders(true),
    body,
  });
  const data = await stReadJson(res);
  if (!res.ok || data?.status === "fail") throw new Error(`HTTP ${res.status}`);
  return data;
}

async function loadNotesState() {
  try {
    const hub = document.getElementById("inta-settings");
    if (!hub) return;
    const label = hub.querySelector("[data-set-notestate]");
    const input = hub.querySelector("[data-set-notetext]");
    try {
      const { mine } = await ntGetMine();
      if (!hub.isConnected) return;
      if (mine?.text) {
        if (label) label.textContent = `live: "${String(mine.text).slice(0, 60)}"`;
        if (input && !input.value) input.value = String(mine.text).slice(0, 60);
        hub.dataset.noteId = String(mine.id ?? mine.pk ?? "");
      } else if (label) {
        label.textContent = "no note yet — post one below";
      }
    } catch {
      if (label) label.textContent = "couldn't load — you can still post";
    }
  } catch {}
}

function openSettingsHub() {
  closeSettingsHub();
  const ov = document.createElement("div");
  ov.id = "inta-settings";
  ov.innerHTML = `
    <div class="inta-set-back" data-set-close="1"></div>
    <div class="inta-set-card" role="dialog" aria-label="All settings">
      <div class="inta-set-head">
        <span class="inta-set-title">${ic("command", 16)}<span>All settings</span></span>
        <button type="button" data-set-close="1" aria-label="Close">${ic("x", 14)}</button>
      </div>
      <input class="inta-set-filter" type="text" placeholder="Filter settings…" aria-label="Filter settings" />
      <div class="inta-set-list">
        <div class="inta-set-sec">Profile</div>
        <a class="inta-set-row" data-words="edit profile bio username name links" href="https://www.instagram.com/accounts/edit/">${ic("edit", 16)}<span><b>Edit profile</b><small>bio, username, links</small></span></a>
        <div class="inta-set-row inta-set-switch" data-words="private public account privacy followers approve">
          ${ic("user", 16)}<span><b>Private account</b><small data-set-privstate="1">checking…</small></span>
          <button type="button" class="inta-switch" data-set-priv="1" role="switch" aria-checked="false" aria-label="Private account"><span></span></button>
        </div>
        <div class="inta-set-sec">Security</div>
        <a class="inta-set-row" data-words="password change security login" href="https://www.instagram.com/accounts/password/change/">${ic("check", 16)}<span><b>Change password</b><small>login security</small></span></a>
        <a class="inta-set-row" data-words="meta accounts center birthday privacy ads security all settings" href="https://accountscenter.instagram.com/" target="_blank" rel="noopener">${ic("external", 16)}<span><b>Accounts Center</b><small>birthday, ads, all Meta settings</small></span></a>
        <div class="inta-set-sec">Data &amp; wellbeing</div>
        <div class="inta-set-row inta-set-switch" data-words="data saver cellular bandwidth autoplay preload">
          ${ic("layers", 16)}<span><b>Data saver</b><small>no autoplay — tap any video to play</small></span>
          <button type="button" class="inta-switch" data-set-dsaver="1" role="switch" aria-checked="false" aria-label="Data saver"><span></span></button>
        </div>
        <div class="inta-set-row" data-words="screen time activity daily limit reminder sleep">
          ${ic("trend", 16)}<span><b>Screen time</b><small data-set-today="1">…</small></span>
          <span class="inta-set-num"><input type="number" min="0" max="1440" step="5" data-set-limit="1" aria-label="Daily limit in minutes" title="Daily limit (minutes, 0 = off)" /><em>min/day</em></span>
        </div>
        <div class="inta-set-sec">Story studio <span class="inta-sec-note">mobile-only</span></div>
        ${soonRow("music", "Music sticker", "licensed tracks on stories", "music sticker licensed audio song")}
        ${soonRow("link", "Link sticker", "hyperlinks on stories", "link sticker url hyperlink swipe")}
        ${soonRow("chart", "Polls, quizzes & sliders", "poll quiz question countdown slider add yours", "poll quiz question countdown slider emoji votes")}
        ${soonRow("user", "Avatar sticker", "3D Meta avatar on stories", "avatar sticker meta 3d face")}
        ${soonRow("hash", "Location & hashtag stickers", "geo + tag overlays", "location hashtag sticker geo tag")}
        ${soonRow("spark", "AR effects & filters", "face filters, Spark AR", "ar filter effect face spark")}
        ${soonRow("film", "Reels templates", "pre-timed trending templates", "reels template trend timing")}
        <div class="inta-set-sec">Messaging <span class="inta-sec-note">mostly mobile-only</span></div>
        <div class="inta-set-row" data-words="notes status bubble dm note text audience post">
          ${ic("message", 16)}<span><b>Notes</b><small data-set-notestate="1">loading…</small></span>
        </div>
        <div class="inta-note-edit" data-words="notes status bubble dm note text audience post">
          <input type="text" maxlength="60" placeholder="Share a thought… (60 max)" data-set-notetext="1" aria-label="Note text" />
          <div class="inta-note-row">
            <select data-set-noteaud="1" aria-label="Note audience">
              <option value="0">Followers you follow back</option>
              <option value="1">Close friends</option>
            </select>
            <button type="button" data-set-notesave="1">Post</button>
            <button type="button" data-set-notedel="1">Delete</button>
          </div>
        </div>
        ${soonRow("camera", "Instants", "instant inbox captures", "instants camera inbox capture")}
        ${soonRow("music", "Voice messages", "audio notes in chat", "voice message audio note record")}
        ${soonRow("eyeoff", "Vanish mode", "disappearing chat messages", "vanish mode disappear temporary")}
        ${soonRow("edit", "Chat themes", "colored thread backgrounds", "theme chat color background thread")}
        ${soonRow("user", "Selfie stickers", "looping face stickers", "selfie sticker face loop")}
        <div class="inta-set-sec">Posts</div>
        <div class="inta-set-row inta-set-action" data-words="story studio compose 9:16 photo video export" data-action="story">
          ${ic("camera", 16)}<span><b>Story studio</b><small>compose 9:16, export for phone upload</small></span>
        </div>
        ${soonRow("edit", "Filter management", "reorder + hide feed filters", "filter manage reorder hide feed")}
        ${soonRow("layers", "Grid rearrangement", "sort your profile grid", "grid rearrange sort profile order")}
        ${soonRow("copy", "Carousel reorder", "reorder photos after posting", "carousel reorder photos multi")}
        ${soonRow("music", "Audio replacement", "swap muted audio on posts", "audio replace swap muted copyright")}
        ${soonRow("film", "Trial reels", "test with non-followers first", "trial reels test non-followers")}
        <div class="inta-set-sec">Device &amp; safety <span class="inta-sec-note">mobile-only</span></div>
        ${soonRow("camera", "Device permissions", "camera, mic, contacts — in your phone settings", "device permissions camera microphone contacts location photos")}
        ${soonRow("external", "Browser autofill", "in-app browser forms — phone settings", "browser autofill payment contact form")}
        ${soonRow("check", "Security checkup", "email, phone, 2FA health — in the app", "security checkup email phone 2fa login")}
        ${soonRow("user", "Supervision", "parental + teen dashboards — in the app", "supervision parental teen family")}
      </div>
      <div class="inta-set-note">"Soon" = needs the native app engine (stickers, AR, DMs). Everything else here works from PC.</div>
    </div>`;
  document.documentElement.appendChild(ov);

  const filter = ov.querySelector(".inta-set-filter");
  const rows = [...ov.querySelectorAll(".inta-set-row")];
  filter.addEventListener("input", () => {
    const q = (filter.value || "").toLowerCase().trim();
    const secs = [...ov.querySelectorAll(".inta-set-sec")];
    rows.forEach((r) => {
      const hit = !q || (r.dataset.words || "").includes(q) || (r.innerText || "").toLowerCase().includes(q);
      r.style.display = hit ? "" : "none";
    });
    secs.forEach((s) => {
      let show = false;
      let n = s.nextElementSibling;
      while (n && !n.classList.contains("inta-set-sec")) {
        if (n.style.display !== "none") { show = true; break; }
        n = n.nextElementSibling;
      }
      s.style.display = show ? "" : "none";
    });
  });

  ov.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-set-close]")) {
      closeSettingsHub();
      return;
    }
    const sw = e.target.closest?.("[data-set-priv]");
    if (sw) {
      e.preventDefault();
      e.stopPropagation();
      togglePrivate(sw);
      return;
    }
    const ds = e.target.closest?.("[data-set-dsaver]");
    if (ds) {
      e.preventDefault();
      e.stopPropagation();
      toggleDataSaver(ds);
      return;
    }
    const soon = e.target.closest?.("[data-soon]");
    if (soon) {
      e.preventDefault();
      e.stopPropagation();
      toast(`${soon.dataset.soon} is coming soon — needs the mobile app for now`);
      return;
    }
    const act = e.target.closest?.("[data-action]");
    if (act?.dataset.action === "story") {
      e.preventDefault();
      e.stopPropagation();
      closeSettingsHub();
      try { window.IntaOpenStory?.(); } catch {}
      return;
    }
    if (e.target.closest?.("[data-set-notesave]")) {
      e.preventDefault();
      e.stopPropagation();
      saveNote();
      return;
    }
    if (e.target.closest?.("[data-set-notedel]")) {
      e.preventDefault();
      e.stopPropagation();
      deleteNote();
      return;
    }
  });
  ov.querySelector("[data-set-limit]")?.addEventListener("change", async (e) => {
    try {
      let v = Math.max(0, Math.min(1440, Number(e.target.value) || 0));
      await chrome.storage.sync.set({ dailyLimitMin: v });
      e.target.value = v || "";
      toast(v ? `Daily limit set: ${v} min` : "Daily limit off");
    } catch {}
  });
  document.addEventListener("keydown", settingsHubKey, true);
  setTimeout(() => { try { filter.focus(); } catch {} }, 40);
  loadPrivateState();
  loadWellbeingState();
  loadNotesState();
}

async function toggleDataSaver(sw) {
  const on = !sw.classList.contains("on");
  try {
    await chrome.storage.sync.set({ dataSaver: on });
  } catch {}
  // S syncs via storage listener; paint instantly for feedback.
  sw.classList.toggle("on", on);
  sw.setAttribute("aria-checked", on ? "true" : "false");
  toast(on ? "Data saver on — tap videos to play" : "Data saver off");
}

async function loadWellbeingState() {
  try {
    const hub = document.getElementById("inta-settings");
    if (!hub) return;
    const sw = hub.querySelector("[data-set-dsaver]");
    if (sw) {
      let on = false;
      try {
        const s = await chrome.storage.sync.get({ dataSaver: false });
        on = !!s.dataSaver;
      } catch {}
      sw.classList.toggle("on", on);
      sw.setAttribute("aria-checked", on ? "true" : "false");
    }
    const day = new Date().toISOString().slice(0, 10);
    let secs = activeSecs;
    try {
      const store = await chrome.storage.local.get({ intaTime: {} });
      secs += ((store && store.intaTime) || {})[day] || 0;
    } catch {}
    const today = hub.querySelector("[data-set-today]");
    if (today) today.textContent = fmtMins(secs) + " · local only";
    const lim = hub.querySelector("[data-set-limit]");
    if (lim) {
      try {
        const s = await chrome.storage.sync.get({ dailyLimitMin: 0 });
        lim.value = Number(s.dailyLimitMin) || "";
      } catch {}
    }
  } catch {}
}

async function saveNote() {
  const hub = document.getElementById("inta-settings");
  const input = hub?.querySelector("[data-set-notetext]");
  const aud = hub?.querySelector("[data-set-noteaud]");
  const label = hub?.querySelector("[data-set-notestate]");
  const text = String(input?.value || "").trim().slice(0, 60);
  if (!text) {
    toast("Type your note first (60 max)");
    try { input?.focus(); } catch {}
    return;
  }
  const audience = Number(aud?.value) === 1 ? 1 : 0;
  if (label) label.textContent = "posting…";
  try {
    await ntCreate(text, audience);
    const { mine } = await ntGetMine().catch(() => ({ mine: null }));
    if (mine?.id != null && hub) {
      try { hub.dataset.noteId = String(mine.id); } catch {}
    }
    if (label) label.textContent = `live: "${text}"`;
    toast("Note posted!");
  } catch (e) {
    console.warn("[Inta-Power] note save failed", e);
    if (label) label.textContent = "post failed — try again";
    toast("Couldn't post note");
  }
}

async function deleteNote() {
  const hub = document.getElementById("inta-settings");
  const label = hub?.querySelector("[data-set-notestate]");
  const input = hub?.querySelector("[data-set-notetext]");
  let id = "";
  try { id = hub?.dataset.noteId || ""; } catch {}
  if (!id) {
    try {
      const { mine } = await ntGetMine();
      id = String(mine?.id ?? mine?.pk ?? "");
      if (hub && id) {
        try { hub.dataset.noteId = id; } catch {}
      }
    } catch {}
  }
  if (!id) {
    toast("No note to delete");
    return;
  }
  if (!confirm("Delete your current note?")) return;
  try {
    await ntDelete(id);
    try { if (hub) hub.dataset.noteId = ""; } catch {}
    if (input) input.value = "";
    if (label) label.textContent = "no note yet — post one below";
    toast("Note deleted");
  } catch (e) {
    console.warn("[Inta-Power] note delete failed", e);
    toast("Couldn't delete note");
  }
}

async function loadPrivateState() {
  try {
    const { isPrivate } = await stReadPrivacy();
    const hub = document.getElementById("inta-settings");
    if (!hub) return;
    const label = hub.querySelector("[data-set-privstate]");
    const sw = hub.querySelector("[data-set-priv]");
    if (isPrivate == null) {
      if (label) label.textContent = "couldn't read — tap to retry";
      return;
    }
    if (label) label.textContent = isPrivate ? "on — only followers see posts" : "off — anyone can see posts";
    if (sw) {
      sw.classList.toggle("on", !!isPrivate);
      sw.setAttribute("aria-checked", isPrivate ? "true" : "false");
    }
  } catch {}
}

async function togglePrivate(sw) {
  const hub = document.getElementById("inta-settings");
  const label = hub?.querySelector("[data-set-privstate]");
  const currentlyOn = sw.classList.contains("on");
  const makePrivate = !currentlyOn;
  const ok = confirm(
    makePrivate
      ? "Make your account PRIVATE? Only approved followers will see your posts."
      : "Make your account PUBLIC? Anyone will be able to see your posts."
  );
  if (!ok) return;
  sw.disabled = true;
  if (label) label.textContent = "saving…";
  try {
    let uid = stUid();
    if (!uid) {
      const st = await stReadPrivacy();
      uid = st.uid;
    }
    if (!uid) throw new Error("no-uid");
    await stSetPrivate(uid, makePrivate);
    const fresh = await stReadPrivacy();
    const done = fresh.isPrivate == null ? true : fresh.isPrivate === makePrivate;
    sw.classList.toggle("on", makePrivate);
    sw.setAttribute("aria-checked", makePrivate ? "true" : "false");
    if (label) label.textContent = makePrivate ? "on — only followers see posts" : "off — anyone can see posts";
    toast(done ? (makePrivate ? "Account is now private" : "Account is now public") : "Saved — verify in Accounts Center");
  } catch (e) {
    console.warn("[Inta-Power] private toggle failed", e);
    if (label) label.textContent = "save failed — try again";
    toast("Couldn't change that setting");
  } finally {
    sw.disabled = false;
  }
}

function settingsHubKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeSettingsHub();
  }
}
function closeSettingsHub() {
  try { document.getElementById("inta-settings")?.remove(); } catch {}
  document.removeEventListener("keydown", settingsHubKey, true);
}

/* ---------------- 12. Data Saver (real) + Screen time (real) ----------------
   Data Saver: videos you tap keep playing (marked on click); everything
   else IG autoplays gets paused back on every tick — no autoplay, no
   background pre-render, less bandwidth. Pure local behavior change.
   Screen time: active seconds on instagram.com accumulate per day in
   storage.local (never leaves the browser). The hub shows today's total
   and an optional daily limit with a once-a-day reminder toast. */
let manualBound = false;
function dataSaverTick() {
  try {
    if (!manualBound) {
      manualBound = true;
      document.addEventListener("click", (e) => {
        try {
          const v = e.target?.closest?.("video");
          if (v) v.dataset.intaManual = "1";
        } catch {}
      }, true);
    }
    document.querySelectorAll("main video").forEach((v) => {
      try {
        if (!v.dataset.intaManual && !v.paused) v.pause();
      } catch {}
    });
  } catch {}
}

let activeSecs = 0;
let lastFlush = 0;
let lastTickAt = 0;
async function activityTick() {
  try {
    if (document.hidden) return;
    // Real elapsed time (capped): ticks can stall in background tabs.
    const now = Date.now();
    if (lastTickAt) activeSecs += Math.min(8, Math.max(0, (now - lastTickAt) / 1000));
    lastTickAt = now;
    if (Date.now() - lastFlush < 30000) return;
    lastFlush = Date.now();
    const day = new Date().toISOString().slice(0, 10);
    const store = await chrome.storage.local.get({ intaTime: {} });
    const t = (store && store.intaTime) || {};
    t[day] = (t[day] || 0) + activeSecs;
    activeSecs = 0;
    const keys = Object.keys(t).sort();
    while (keys.length > 14) delete t[keys.shift()];
    await chrome.storage.local.set({ intaTime: t });
    let lim = 0;
    try {
      const s = await chrome.storage.sync.get({ dailyLimitMin: 0 });
      lim = Number(s.dailyLimitMin) || 0;
    } catch {}
    if (lim > 0 && (t[day] || 0) >= lim * 60) {
      const flag = "intaWarn_" + day;
      let warned = false;
      try {
        const f = await chrome.storage.local.get({ [flag]: false });
        warned = !!f[flag];
      } catch {}
      if (!warned) {
        try { await chrome.storage.local.set({ [flag]: true }); } catch {}
        toast(`Daily limit reached (${lim} min) — take a break`);
      }
    }
  } catch {}
}

function fmtMins(secs) {
  const m = Math.round((Number(secs) || 0) / 60);
  if (m < 60) return `${m} min today`;
  return `${Math.floor(m / 60)}h ${m % 60}m today`;
}

/* ---------------- 13. Story Studio: compose 9:16 on PC ----------------
   Hard truth: Instagram ships NO web story composer, so no desktop code
   can post a story directly — the private upload path is undocumented
   for web sessions and risks an action-block on your account, so we
   don't touch it. What IS real: compose the story file on PC (correct
   1080x1920 cover-crop, zoom, live 9:16 preview) and export it for a
   one-tap phone upload. Entry: Ctrl+K → Story studio, hub Posts row. */
window.IntaOpenStory = function () {
  try {
    openStoryStudio();
    return true;
  } catch {
    return false;
  }
};

function openStoryStudio() {
  closeStoryStudio();
  const ov = document.createElement("div");
  ov.id = "inta-story-studio";
  ov.innerHTML = `
    <div class="inta-ss-back" data-ss-close="1"></div>
    <div class="inta-ss-card" role="dialog" aria-label="Story studio">
      <div class="inta-ss-head">
        <span class="inta-ss-title">${ic("camera", 16)}<span>Story studio</span></span>
        <button type="button" data-ss-close="1" aria-label="Close">${ic("x", 14)}</button>
      </div>
      <div class="inta-ss-sub">Compose 9:16 on PC, export, post from your phone — Instagram has no web story composer.</div>
      <label class="inta-ss-pick">Choose photo or video<input type="file" accept="image/*,video/*" data-ss-file="1" hidden /></label>
      <div class="inta-ss-stage"><span class="inta-ss-empty">9:16 preview</span></div>
      <label class="inta-ss-zoom">Zoom <input type="range" min="100" max="250" value="100" data-ss-zoom="1" /></label>
      <div class="inta-ss-foot">
        <button type="button" data-ss-close="1">Cancel</button>
        <button type="button" class="primary" data-ss-save="1">Export story file</button>
      </div>
    </div>`;
  document.documentElement.appendChild(ov);

  let kind = null;
  let objUrl = null;
  let imgEl = null;
  let zoom = 1;
  const stage = ov.querySelector(".inta-ss-stage");
  const file = ov.querySelector("[data-ss-file]");
  const zoomIn = ov.querySelector("[data-ss-zoom]");

  const applyZoom = () => {
    try {
      const m = stage.querySelector(".inta-ss-media");
      if (m) m.style.transform = `scale(${zoom})`;
    } catch {}
  };
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    if (!f) return;
    if (objUrl) {
      try { URL.revokeObjectURL(objUrl); } catch {}
    }
    objUrl = URL.createObjectURL(f);
    stage.innerHTML = "";
    if ((f.type || "").startsWith("video")) {
      kind = "video";
      const v = document.createElement("video");
      v.src = objUrl;
      v.controls = true;
      v.loop = true;
      v.muted = true;
      v.className = "inta-ss-media";
      stage.appendChild(v);
    } else {
      kind = "image";
      imgEl = new Image();
      imgEl.src = objUrl;
      imgEl.className = "inta-ss-media";
      imgEl.addEventListener("load", applyZoom);
      stage.appendChild(imgEl);
    }
    applyZoom();
  });
  zoomIn.addEventListener("input", () => {
    zoom = (Number(zoomIn.value) || 100) / 100;
    applyZoom();
  });
  ov.addEventListener("click", (e) => {
    if (e.target.closest?.("[data-ss-close]")) {
      closeStoryStudio();
      return;
    }
    if (e.target.closest?.("[data-ss-save]")) {
      exportStory();
    }
  });
  document.addEventListener("keydown", storyStudioKey, true);

  function exportStory() {
    try {
      if (kind === "image" && imgEl?.complete && imgEl.naturalWidth) {
        const W = 1080;
        const H = 1920;
        const cv = document.createElement("canvas");
        cv.width = W;
        cv.height = H;
        const cx = cv.getContext("2d");
        if (!cx) throw new Error("no-2d");
        const iw = imgEl.naturalWidth;
        const ih = imgEl.naturalHeight;
        const base = Math.max(W / iw, H / ih) * zoom;
        const dw = iw * base;
        const dh = ih * base;
        cx.fillStyle = "#000";
        cx.fillRect(0, 0, W, H);
        cx.drawImage(imgEl, (W - dw) / 2, (H - dh) / 2, dw, dh);
        cv.toBlob((blob) => {
          if (!blob) return toast("Export failed");
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `insta-story-1080x1920-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 15000);
          toast("Story file saved — send it to your phone");
        }, "image/png");
        return;
      }
      if (kind === "video" && objUrl) {
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = `insta-story-src-${Date.now()}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast("Video saved — upload it as a story from your phone");
        return;
      }
      toast("Choose a photo or video first");
    } catch {
      toast("Export failed");
    }
  }
}

function storyStudioKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeStoryStudio();
  }
}
function closeStoryStudio() {
  try { document.getElementById("inta-story-studio")?.remove(); } catch {}
  document.removeEventListener("keydown", storyStudioKey, true);
}

/* ---------------- 14. Auto-unmute reels + reel-view routing ----------------
   Instagram starts every reel muted, so scrolling means unmuting by
   hand each time. We unmute the centered playing reel automatically
   (unmuting a PLAYING video needs no gesture — only starting with
   sound does). Respects explicit choice: muting via our toolkit sets
   intaUserMuted and that clip is never touched again. Skipped while
   paused (Data Saver) — unmuting silence is pointless. */
function autoUnmuteTick() {
  try {
    const p = location.pathname;
    const inReels = p.startsWith("/reel");
    const dlg = inReels ? null : document.querySelector('div[role="dialog"]');
    const scope = inReels ? document.querySelector("main") : dlg;
    if (!scope) return;
    const vids = [...scope.querySelectorAll("video")].filter((v) => {
      try {
        const r = v.getBoundingClientRect();
        return r.width > 200 && r.height > 200 && r.bottom > 0 && r.top < window.innerHeight;
      } catch { return false; }
    });
    if (!vids.length) return;
    const cy = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    for (const v of vids) {
      try {
        const r = v.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - cy);
        if (d < bestDist) {
          bestDist = d;
          best = v;
        }
      } catch {}
    }
    if (best && best.muted && !best.paused && best.dataset.intaUserMuted !== "1") {
      try { best.muted = false; } catch {}
    }
  } catch {}
}

// Explore-clicked reels open as a side-comments modal; this offers (or,
// with reelRedirect, forces) the fullscreen /reel/ view instead.
function reelDialogTick() {
  try {
    const btn = document.getElementById("inta-reelview");
    const dlg = document.querySelector('div[role="dialog"]');
    if (!dlg) {
      btn?.remove();
      return;
    }
    if (location.pathname.startsWith("/reel")) {
      btn?.remove();
      return;
    }
    const video = dlg.querySelector("video");
    if (!video) {
      btn?.remove();
      return;
    }
    const a = dlg.querySelector('a[href^="/reel/"], a[href^="/p/"]');
    const m = (a?.getAttribute("href") || "").match(/^\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
    if (!m) {
      btn?.remove();
      return;
    }
    const url = "https://www.instagram.com/reel/" + m[1] + "/";
    if (S.reelRedirect) {
      btn?.remove();
      location.replace(url);
      return;
    }
    if (btn?.isConnected) return;
    const b = document.createElement("button");
    b.id = "inta-reelview";
    b.type = "button";
    b.innerHTML = ic("play", 16) + "<span>Reel view</span>";
    b.title = "Open fullscreen reel view";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.href = url;
    });
    document.documentElement.appendChild(b);
  } catch {}
}

/* ---------------- 15. Click a reel → it OPENS (no more dead stops) ----------------
   Instagram pauses on video click, so tapping a reel just freezes it.
   With this on, clicking the video itself opens the fullscreen reel
   view instead (bubble phase, after IG's own toggle — navigation wins).
   Never hijacks: our buttons (stopPropagation), IG controls (not the
   <video> node), dialogs (they have their own Reel view button),
   modified clicks, or clips without a resolvable /reel/ link. */
let clickReelBound = false;
function bindClickOpensReel() {
  if (clickReelBound) return;
  clickReelBound = true;
  document.addEventListener("click", (e) => {
    try {
      if (!S.clickOpensReel) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.target?.closest?.("#inta-settings, #inta-palette, #inta-story-studio, #inta-search-overlay")) return;
      if (e.target?.closest?.('div[role="dialog"]')) return;
      const video = e.target?.closest?.("video");
      if (!video) return; // IG controls are separate nodes, never the <video> itself
      if (video.closest("#inta-story-studio, #inta-search-overlay")) return;
      const code = reelCodeForVideo(video);
      if (!code) return;
      e.preventDefault();
      location.href = "https://www.instagram.com/reel/" + code + "/";
    } catch {}
  });
}

function reelCodeForVideo(video) {
  // Airtight rule: navigate only when every /reel/ link in scope agrees
  // on ONE code — never open the wrong reel from a mixed container.
  try {
    let el = video.closest("article") || video.parentElement;
    let guard = 0;
    while (el && guard < 8) {
      const codes = new Set();
      for (const a of el.querySelectorAll?.('a[href^="/reel/"]') || []) {
        const m = (a.getAttribute("href") || "").match(/^\/reel\/([A-Za-z0-9_-]+)/);
        if (m) codes.add(m[1]);
      }
      if (codes.size === 1) return [...codes][0];
      if (el.tagName === "ARTICLE" || el.tagName === "MAIN") break;
      el = el.parentElement;
      guard++;
    }
  } catch {}
  return null;
}

/* ---------------- helpers ---------------- */
function copyText(text, okMsg) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(okMsg || "Copied!"), () => toast(okMsg || "Copied!"));
  } else toast("Copy failed");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

})();
