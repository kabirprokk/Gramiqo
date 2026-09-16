// background.js - Gramiqo downloads + Mobile-Mode (UA spoof)
// Production-level: guarded, no throw, MV3 service-worker safe.

const RULE_ID = 1001;
const HINT_ID = 1002; // client-hints rule: isolated ID so a rejection can't kill the UA rule
const SPOOF_ID = "inta-spoof"; // page-world navigator spoof (spoof.js)
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// --- downloads (single + bulk queue) ---
const dlQueue = [];
let dlActive = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "GRAMI_GET_MEDIA" || msg.type === "INTA_GET_MEDIA") {
    // Best direct video file seen on this tab (beats blob:/protected URLs).
    // Prefer full progressive files over DASH range segments: a segment URL
    // (bytestart/byteend) only yields a slice of bytes, which audio/video
    // decode can't use — so rank full files first, newest wins ties.
    try {
      const arr = mediaByTab.get(sender?.tab?.id) || [];
      let best = null;
      for (const it of arr) {
        if (!best || it.rank > best.rank || (it.rank === best.rank && it.at >= best.at)) best = it;
      }
      sendResponse({ ok: true, url: best ? best.url : "" });
    } catch {
      try { sendResponse({ ok: false, url: "" }); } catch {}
    }
    return false;
  }
  if (msg.type === "GRAMI_DOWNLOAD" || msg.type === "INTA_DOWNLOAD") {
    queueDownload(msg.url, msg.filename).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true; // async response
  }
  if (msg.type === "GRAMI_DOWNLOAD_MANY" || msg.type === "INTA_DOWNLOAD_MANY") {
    const items = Array.isArray(msg.items) ? msg.items.slice(0, 20) : [];
    (async () => {
      let ok = 0, fail = 0;
      for (const it of items) {
        try { await queueDownload(it.url, it.filename); ok++; }
        catch { fail++; }
      }
      sendResponse({ ok: true, downloaded: ok, failed: fail });
    })();
    return true;
  }
  if (msg.type === "GRAMI_FETCH_BYTES") {
    // Audio path: fetch the direct .mp4 from the worker (extension origin +
    // host permissions), so page-context CORS/CSP can never block extraction.
    // CDN links are signed query URLs — no page cookies needed. A Referer is
    // sent because some CDN edges reject referer-less fetches, and DASH
    // range slices are expanded to the full file (a slice alone is useless).
    (async () => {
      try {
        const u = String(msg.url || "");
        if (!/^https?:\/\//.test(u)) throw new Error("bad-url");
        const full = stripRangeParams(u);
        const res = await fetch(full, {
          headers: { Referer: "https://www.instagram.com/", Accept: "*/*" },
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = await res.arrayBuffer();
        if (!buf || !buf.byteLength) throw new Error("empty-file");
        if (buf.byteLength > 120 * 1024 * 1024) throw new Error("too-big");
        sendResponse({ ok: true, buf: buf });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true;
  }
  return false;
});

// Drop DASH range params so a remembered segment URL fetches the full file.
function stripRangeParams(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("bytestart");
    u.searchParams.delete("byteend");
    return u.toString();
  } catch {
    return url;
  }
}

function queueDownload(url, filename) {
  return new Promise((resolve, reject) => {
    dlQueue.push({ url, filename, resolve, reject });
    pumpQueue();
  });
}

function pumpQueue() {
  if (dlActive) return;
  const job = dlQueue.shift();
  if (!job) return;
  dlActive = true;
  const url = String(job.url || "");
  if (!/^https?:\/\//.test(url)) {
    dlActive = false;
    job.reject(new Error("bad-url"));
    pumpQueue();
    return;
  }
  const filename = sanitizeFilename(
    job.filename || `gramiqo-${Date.now()}.${guessExt(url)}`
  );
  chrome.downloads
    .download({ url, filename, saveAs: false, conflictAction: "uniquify" })
    .then(
      () => { dlActive = false; job.resolve(); setTimeout(pumpQueue, 600); },
      (err) => { dlActive = false; job.reject(err); setTimeout(pumpQueue, 600); }
    );
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[\\/:*?"<>|#]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function guessExt(url) {
  try {
    const clean = String(url).split("?")[0].toLowerCase();
    if (clean.includes(".mp4")) return "mp4";
    if (clean.includes(".webm")) return "webm";
    if (clean.includes(".mov")) return "mov";
    if (clean.includes(".png")) return "png";
    if (clean.includes(".webp")) return "webp";
    return "jpg";
  } catch {
    return "jpg";
  }
}

// --- Direct media URL memory (ultra-fast, unprotected downloads) ---
// Instagram increasingly serves video as blob:/DRM streams, whose element
// URL can't be saved. But the real .mp4 file still crosses the network —
// remember the best video file per tab so downloads use it directly.
// Two signals: URL shape (extension or fbcdn range/dash hints) and the real
// Content-Type response header (catches video URLs with no file extension).
const mediaByTab = new Map();
function looksLikeVideoFile(u) {
  try {
    const s = String(u || "").toLowerCase();
    if (!/^https?:\/\//.test(s)) return false;
    // Never media: images, styles, scripts, API JSON.
    if (/\.(jpg|jpeg|png|webp|gif|avif|svg|ico|css|js|json)(\?|#|$)/.test(s)) return false;
    if (s.includes("sprite") || s.includes("emoji")) return false;
    // Full progressive files.
    if (/\.(mp4|mov|m4v|webm|mp3|m4a|aac)(\?|#|$)/.test(s)) return true;
    // fbcdn range/dash video fetches (no extension, still video bytes).
    if (s.includes("bytestart") || s.includes("byteend")) return true;
    if (s.includes("mime=video") || s.includes("mime=audio")) return true;
    if (s.includes("/dash/") || s.includes("dash_") || s.includes("video_dash")) return true;
    return false;
  } catch {
    return false;
  }
}
// Full files (rank 2) beat extension-less video URLs (rank 1) beat range
// segments (rank 0, only a byte slice — undecodable on their own).
function rankMediaUrl(u) {
  try {
    const s = String(u || "").toLowerCase();
    if (s.includes("bytestart") || s.includes("byteend")) return 0;
    if (/\.(mp4|mov|m4v|webm|mp3|m4a|aac)(\?|#|$)/.test(s)) return 2;
    return 1;
  } catch {
    return 0;
  }
}
function storeMediaUrl(tabId, rawUrl) {
  try {
    const u = String(rawUrl || "").split("#")[0];
    if (!u) return;
    if (tabId == null || tabId < 0) return;
    let arr = mediaByTab.get(tabId);
    if (!arr) {
      arr = [];
      mediaByTab.set(tabId, arr);
    }
    if (arr.length && arr[arr.length - 1].url === u) return;
    arr.push({ url: u, at: Date.now(), rank: rankMediaUrl(u) });
    while (arr.length > 10) arr.shift();
  } catch {}
}
function rememberMedia(details) {
  try {
    const u = String(details?.url || "");
    // <video>/<audio> element loads are always worth remembering.
    if (details?.type !== "media" && !looksLikeVideoFile(u)) return;
    if (/\.(jpg|jpeg|png|webp|gif|avif|svg)(\?|#|$)/i.test(u)) return;
    storeMediaUrl(details?.tabId, u);
  } catch {}
}
// Header sniffing: the ground truth when URLs carry no extension.
// (Playlists like mpegurl are skipped — a playlist isn't decodable bytes.)
function rememberMediaByHeaders(details) {
  try {
    const u = String(details?.url || "");
    if (!/^https?:\/\//.test(u)) return;
    const hs = details?.responseHeaders || [];
    let ct = "";
    for (const h of hs) {
      try {
        if (String(h?.name || "").toLowerCase() === "content-type") {
          ct = String(h?.value || "").toLowerCase();
          break;
        }
      } catch {}
    }
    if (!ct) return;
    if (ct.includes("mpegurl") || ct.includes("m3u8") || ct.includes("mpd")) return;
    if (!(ct.startsWith("video/") || ct.startsWith("audio/"))) return;
    storeMediaUrl(details?.tabId, u);
  } catch {}
}
try {
  if (chrome.webRequest?.onResponseStarted) {
    chrome.webRequest.onResponseStarted.addListener(rememberMedia, {
      urls: ["*://*.fbcdn.net/*", "*://*.cdninstagram.com/*", "*://*.instagram.com/*"],
    });
  }
  if (chrome.webRequest?.onHeadersReceived) {
    chrome.webRequest.onHeadersReceived.addListener(rememberMediaByHeaders, {
      urls: ["*://*.fbcdn.net/*", "*://*.cdninstagram.com/*", "*://*.instagram.com/*"],
    }, ["responseHeaders"]);
  }
} catch (e) {
  console.warn("[Gramiqo] media memory unavailable", e);
}
try {
  chrome.tabs?.onRemoved?.addListener((tabId) => {
    try { mediaByTab.delete(tabId); } catch {}
  });
} catch {}

// --- Mobile-Mode: UA rule + client-hints rule + page-world spoof script ---
// Three layers so instagram.com reads "iPhone" everywhere it looks:
//   1. User-Agent request header (main page load)
//   2. Sec-CH-UA-Mobile / Platform / brands (what modern detection reads)
//   3. navigator.* in page JS (spoof.js, MAIN world, document_start)
// Layer 2 uses its own rule ID: if Chrome ever rejects a client-hints
// modification, the UA rule still stands.
async function applyMobileMode() {
  try {
    const { mobileMode } = await chrome.storage.sync.get({ mobileMode: false });
    const on = !!mobileMode;
    if (chrome.declarativeNetRequest?.updateDynamicRules) {
      if (on) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [RULE_ID],
          addRules: [
            {
              id: RULE_ID,
              priority: 1,
              action: {
                type: "modifyHeaders",
                requestHeaders: [
                  { header: "user-agent", operation: "set", value: IPHONE_UA },
                ],
              },
              condition: {
                urlFilter: "|https://*.instagram.com/*",
                resourceTypes: ["main_frame"],
              },
            },
          ],
        });
        try {
          // DATA-SAFETY FIX: spoof headers on main_frame ONLY. Covering
          // sub_frame/xmlhttprequest made every Instagram data call claim
          // iOS-Safari while running desktop Chrome — the backend answered
          // with wrong/empty bundles and the feed rendered as an empty
          // black shell (sidebar + footer only). Page identity can pretend;
          // data traffic must stay truthful.
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [HINT_ID],
            addRules: [
              {
                id: HINT_ID,
                priority: 1,
                action: {
                  type: "modifyHeaders",
                  requestHeaders: [
                    { header: "sec-ch-ua-mobile", operation: "set", value: "?1" },
                    { header: "sec-ch-ua-platform", operation: "set", value: '"iOS"' },
                    {
                      header: "sec-ch-ua",
                      operation: "set",
                      value: '"Safari";v="17", "Mobile Safari";v="17", "Not;A=Brand";v="99"',
                    },
                  ],
                },
                condition: {
                  urlFilter: "|https://*.instagram.com/*",
                  resourceTypes: ["main_frame"],
                },
              },
            ],
          });
        } catch (e) {
          console.warn("[Gramiqo] client-hints rule skipped", e);
        }
      } else {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [RULE_ID, HINT_ID],
        });
      }
    }
    await applySpoofScript(on);
  } catch (e) {
    console.warn("[Gramiqo] mobile-mode rule failed", e);
  }
}

// Register/unregister the MAIN-world spoof with the toggle (a tab reload
// applies the change — popup already reloads IG on toggle).
async function applySpoofScript(on) {
  try {
    const api = chrome.scripting;
    if (!api?.registerContentScripts) return;
    const props = {
      id: SPOOF_ID,
      matches: ["*://*.instagram.com/*"],
      js: ["spoof.js"],
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: false,
    };
    let existing = [];
    try {
      existing = await api.getRegisteredContentScripts({ ids: [SPOOF_ID] });
    } catch {}
    if (on) {
      if (existing && existing.length) await api.updateContentScripts([props]);
      else await api.registerContentScripts([props]);
    } else if (existing && existing.length) {
      await api.unregisterContentScripts({ ids: [SPOOF_ID] });
    }
  } catch (e) {
    console.warn("[Gramiqo] spoof script sync failed", e);
  }
}

// One-time heal (v1.1.3): Mobile feel defaulted ON in 1.0.x–1.1.2 and its
// iPhone UA blanked instagram.com for desktop users. That bad value lives
// in chrome.storage.sync, so reinstalls kept resurrecting it. On worker
// start (install/update/reload/browser-start) migrate it OFF once, drop
// the spoof rules, and reload open IG tabs so the fix is visible without
// the user hunting through settings. Explicit opt-ins AFTER this run are
// respected (flagged).
async function migrateMobileDefault() {
  try {
    const s = await chrome.storage.sync.get({ mobileMode: false, intaMigrated113: false });
    if (s.mobileMode === true && s.intaMigrated113 !== true) {
      await chrome.storage.sync.set({ mobileMode: false, intaMigrated113: true });
      try {
        const tabs = await chrome.tabs.query({ url: "*://*.instagram.com/*" });
        for (const t of tabs) {
          if (t.id != null) {
            try { await chrome.tabs.reload(t.id); } catch {}
          }
        }
      } catch {}
    } else if (s.intaMigrated113 !== true) {
      try { await chrome.storage.sync.set({ intaMigrated113: true }); } catch {}
    }
  } catch (e) {
    console.warn("[Gramiqo] migration check failed", e);
  }
}

chrome.runtime.onInstalled.addListener(applyMobileMode);
chrome.runtime.onStartup.addListener(applyMobileMode);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.mobileMode) applyMobileMode();
});
migrateMobileDefault().then(() => applyMobileMode());
