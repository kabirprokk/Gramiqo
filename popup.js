// popup.js - controls the ON/OFF switches, saved in chrome.storage
const DEFAULTS = {
  mobileMode: false, // OFF: desktop Instagram renders correctly; opt-in for iPhone feel
  profileTools: true,
  enhancedSearch: true,
  keywordSearch: true,
  downloadBtn: true,
  hdPfp: true,
  copyCaption: true,
  storySaver: true,
  reelsToolkit: true,
  bulkSaver: true,
  cmdPalette: true,
  statsHistory: true,
  hashtagTools: true,
  centerStage: true,
  quickCreate: true,
  dataSaver: false,
  autoUnmute: true,
  reelRedirect: false,
  clickOpensReel: true,
  ghostMode: false,
  zoomHover: true,
  darkMode: false,
  wideFeed: false
};

document.addEventListener("DOMContentLoaded", async () => {
  // load saved values into checkboxes
  let stored = { ...DEFAULTS };
  try {
    stored = await chrome.storage.sync.get(DEFAULTS);
  } catch (e) {
    console.warn("[Gramiqo] storage unavailable", e);
  }
  for (const key in DEFAULTS) {
    const box = document.getElementById(key);
    if (!box) continue;
    box.checked = stored[key] ?? DEFAULTS[key];
    box.addEventListener("change", () => {
      try {
        chrome.storage.sync.set({ [key]: box.checked });
      } catch {}
    });
  }

  document.getElementById("openInsta").onclick = () => {
    chrome.tabs.create({ url: "https://www.instagram.com/" });
  };

  document.getElementById("openSettings").onclick = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null && (tab.url || "").includes("instagram.com")) {
        chrome.tabs.sendMessage(tab.id, { type: "GRAMI_OPEN_SETTINGS" });
      } else {
        chrome.tabs.create({ url: "https://www.instagram.com/" });
      }
    } catch {}
  };

  document.getElementById("copyDiag")?.addEventListener("click", async () => {
    const status = document.getElementById("diagStatus");
    const say = (t) => { if (status) status.textContent = t; };
    say("Reading Instagram tab…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !(tab.url || "").includes("instagram.com")) {
        say("Open instagram.com first, then click again.");
        return;
      }
      let res = null;
      try {
        res = await chrome.tabs.sendMessage(tab.id, { type: "GRAMI_GET_DIAG" });
      } catch (e) {
        say("No answer — reload the extension + hard-refresh IG (Ctrl+Shift+R).");
        return;
      }
      if (!res || !res.ok || !res.diag) {
        say("Empty answer — hard-refresh the IG tab and retry.");
        return;
      }
      const text = "GRAMI-DIAG " + JSON.stringify(res.diag);
      try {
        await navigator.clipboard.writeText(text);
        say(`Copied! Paste it here (grid=${res.diag.counts?.grid ?? "?"}).`);
      } catch {
        say(text.slice(0, 400));
      }
    } catch (e) {
      say("Failed: " + String((e && e.message) || e).slice(0, 100));
    }
  });
  // Nuclear reset: clears stuck sync/local state (e.g. Mobile feel stuck ON
  // causing a blank IG page even after reinstall — sync storage survives
  // reinstalls). Defaults are desktop-safe, then IG tabs reload.
  document.getElementById("resetAll")?.addEventListener("click", async () => {
    if (!confirm("Reset all Gramiqo settings to defaults?")) return;
    try { await chrome.storage.sync.clear(); } catch {}
    try { await chrome.storage.local.clear(); } catch {}
    try {
      const tabs = await chrome.tabs.query({ url: "*://*.instagram.com/*" });
      for (const t of tabs) if (t.id != null) try { chrome.tabs.reload(t.id); } catch {}
    } catch {}
    window.close();
  });

  // Mobile-Mode needs a hard reload to take effect (UA is read on page load)
  document.getElementById("mobileMode")?.addEventListener("change", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes("instagram.com")) chrome.tabs.reload(tab.id);
    } catch {}
  });
});
