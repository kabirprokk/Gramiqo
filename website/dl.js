/* Gramiqo hidden downloader (website/d.html) — vanilla, zero deps.
   Flow: ?url=<ig-link>&auto=1&src=ext&mid=<direct-media>&fn=<name>
   1. mid (extension already resolved a real .mp4/.jpg) → show + auto-save it. Fastest, no API.
   2. else GET /api/resolve?url= → card + quality rows → auto=1 auto-saves best.
   Like fastdl/indown/saveclip: paste → fetch → save. Extension visitors skip paste entirely. */
(function () {
"use strict";
var $ = function (id) { return document.getElementById(id); };
var input = $("dlInput"), go = $("dlGo"), status = $("dlStatus");
var result = $("dlResult"), thumb = $("dlThumb"), title = $("dlTitle"), sub = $("dlSub"), rows = $("dlRows");
try { var y = $("yr"); if (y) y.textContent = String(new Date().getFullYear()); } catch (e) {}

function say(msg, cls) {
  try {
    status.textContent = msg || "";
    status.className = "dl-status" + (cls ? " " + cls : "");
  } catch (e) {}
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function validIg(u) {
  try {
    var p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return false;
    var h = p.hostname.toLowerCase();
    if (h !== "instagram.com" && h.slice(-14) !== ".instagram.com") return false;
    return /\/(p|reel|reels|tv)\/[A-Za-z0-9_-]{5,}/.test(p.pathname) || /\/stories\//.test(p.pathname);
  } catch (e) { return false; }
}
function params() {
  var q = {};
  try {
    var sp = new URLSearchParams(location.search);
    ["url", "auto", "src", "mid", "fn"].forEach(function (k) { q[k] = sp.get(k) || ""; });
  } catch (e) {}
  return q;
}
// Force-save a same-origin / CORS-open media URL without navigating away.
var autoFired = false;
async function saveMedia(mediaUrl, filename) {
  var name = String(filename || ("gramiqo-" + Date.now() + ".mp4")).slice(0, 120);
  try {
    say("Downloading…");
    var res = await fetch(mediaUrl, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var blob = await res.blob();
    if (!blob || blob.size < 1024) throw new Error("empty");
    var a = document.createElement("a");
    var obj = URL.createObjectURL(blob);
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(obj); } catch (e) {} }, 20000);
    say("Saved — check your Downloads folder.", "ok");
  } catch (e) {
    // CORS-blocked CDN edge → new-tab fallback still saves the file.
    try { window.open(mediaUrl, "_blank", "noopener"); } catch (e2) {}
    say("Opened full quality in a new tab — long-press / right-click → Save.", "ok");
  }
}
function renderCard(data, auto, filename) {
  try {
    result.hidden = false;
    var t = data.thumbnail || (data.medias && data.medias[0] && data.medias[0].thumb) || "";
    if (t) { thumb.src = t; thumb.style.display = ""; } else { thumb.style.display = "none"; }
    title.textContent = data.title || (data.type === "video" ? "Video ready" : "Photo ready");
    sub.textContent = (data.author ? "@" + data.author + " · " : "") + (data.type === "video" ? "MP4 · original quality" : "JPG · full resolution");
    rows.innerHTML = "";
    (data.medias || []).forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "dl-row";
      var label = m.quality || (data.type === "video" ? "MP4" : "JPG");
      row.innerHTML = '<span class="q">' + esc(label) + '</span><span class="t">' +
        esc(m.width ? m.width + "p" : (data.type === "video" ? "video" : "photo")) + "</span>";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn small";
      b.textContent = "Save";
      b.addEventListener("click", function () {
        saveMedia(m.url, filename || ("gramiqo-" + Date.now() + (data.type === "video" ? ".mp4" : ".jpg")));
      });
      row.appendChild(b);
      rows.appendChild(row);
      if (auto && i === 0 && !autoFired) {
        autoFired = true;
        setTimeout(function () { b.click(); }, 350);
      }
    });
    if (!(data.medias || []).length) say("No downloadable media found for this link.", "err");
  } catch (e) { say("Couldn't render results.", "err"); }
}
async function resolve(url, auto, filename) {
  if (!validIg(url)) { say("That doesn't look like an Instagram reel/post link.", "err"); return; }
  say(auto ? "Sent from the extension — fetching original quality…" : "Fetching original quality…");
  result.hidden = true;
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 20000);
    var res = await fetch("/api/resolve?url=" + encodeURIComponent(url), { signal: ctrl.signal });
    clearTimeout(t);
    var j = null;
    try { j = await res.json(); } catch (e) {}
    if (!res.ok || !j || j.ok !== true) {
      var msg = (j && j.error) || ("HTTP " + res.status);
      if (/private|login/i.test(msg)) say("This post needs login (private). Open it with the Gramiqo extension — it downloads with your own session.", "err");
      else say("Couldn't read that link (" + msg + "). Check it's public and try again.", "err");
      return;
    }
    say(j.medias && j.medias.length > 1 ? j.medias.length + " files found — saving the best…" : "Found it — saving…", "ok");
    renderCard(j, auto, filename);
  } catch (e) {
    say("Network hiccup — tap Download to retry.", "err");
  }
}
function boot() {
  var q = params();
  if (q.url) { try { input.value = q.url; } catch (e) {} }
  // Fastest path: extension already resolved a real file → save it, skip API.
  if (q.mid && /^https?:\/\//.test(q.mid)) {
    var isVid = /\.mp4(\?|#|$)/i.test(q.mid) || /video/i.test(q.mid);
    renderCard({
      type: isVid ? "video" : "image",
      title: "Sent from Instagram — ready",
      author: "",
      thumbnail: isVid ? "" : q.mid,
      medias: [{ url: q.mid, quality: isVid ? "MP4" : "JPG", width: 0 }],
    }, q.auto === "1", q.fn);
    return;
  }
  if (q.url && q.auto === "1") { resolve(q.url, true, q.fn); return; }
  if (q.url) { resolve(q.url, false, q.fn); }
}
go.addEventListener("click", function () {
  var u = (input.value || "").trim();
  try {
    var canon = new URL(u);
    history.replaceState(null, "", "?url=" + encodeURIComponent(canon.toString()));
  } catch (e) {}
  resolve(u, false, "");
});
input.addEventListener("keydown", function (e) {
  if (e.key === "Enter") { e.preventDefault(); go.click(); }
});
boot();
})();
