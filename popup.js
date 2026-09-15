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
    console.warn("[Inta-Enhancer] storage unavailable", e);
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
        chrome.tabs.sendMessage(tab.id, { type: "INTA_OPEN_SETTINGS" });
      } else {
        chrome.tabs.create({ url: "https://www.instagram.com/" });
      }
    } catch {}
  };

  // Mobile-Mode needs a hard reload to take effect (UA is read on page load)
  document.getElementById("mobileMode")?.addEventListener("change", async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes("instagram.com")) chrome.tabs.reload(tab.id);
    } catch {}
  });
});
