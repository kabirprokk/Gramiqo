// background.js - downloads + Mobile-Mode (UA spoof)
// Production-level: guarded, no throw, MV3 service-worker safe.

const RULE_ID = 1001;
const HINT_ID = 1002; // client-hints rule: isolated ID so a rejection can't kill the UA rule
const SPOOF_ID = "inta-spoof"; // page-world navigator spoof (spoof.js)
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// --- downloads (single + bulk queue) ---
const dlQueue = [];
let dlActive = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "INTA_DOWNLOAD") {
    queueDownload(msg.url, msg.filename).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
    );
    return true; // async response
  }
  if (msg.type === "INTA_DOWNLOAD_MANY") {
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
  return false;
});

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
    job.filename || `inta-enhancer-${Date.now()}.${guessExt(url)}`
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

// --- Mobile-Mode: UA rule + client-hints rule + page-world spoof script ---
// Three layers so instagram.com reads "iPhone" everywhere it looks:
//   1. User-Agent request header (main page load)
//   2. Sec-CH-UA-Mobile / Platform / brands (what modern detection reads)
//   3. navigator.* in page JS (spoof.js, MAIN world, document_start)
// Layer 2 uses its own rule ID: if Chrome ever rejects a client-hints
// modification, the UA rule still stands.
async function applyMobileMode() {
  try {
    const { mobileMode } = await chrome.storage.sync.get({ mobileMode: true });
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
                  resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"],
                },
              },
            ],
          });
        } catch (e) {
          console.warn("[Inta-Enhancer] client-hints rule skipped", e);
        }
      } else {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [RULE_ID, HINT_ID],
        });
      }
    }
    await applySpoofScript(on);
  } catch (e) {
    console.warn("[Inta-Enhancer] mobile-mode rule failed", e);
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
    console.warn("[Inta-Enhancer] spoof script sync failed", e);
  }
}

chrome.runtime.onInstalled.addListener(applyMobileMode);
chrome.runtime.onStartup.addListener(applyMobileMode);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.mobileMode) applyMobileMode();
});
applyMobileMode();
