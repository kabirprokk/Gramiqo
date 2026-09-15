/* ============================================================
   Inta-Enhancer - search.js v2.1 (native Meta UI)
   Mirrors mobile Meta search look inside desktop Instagram:
   Tabs: For you | Accounts | Reels | Audio | Tags
   - AI summary card (built from live topsearch, not fake)
   - Ask pills + Sources (real links)
   - Suggested Reels grid (top clips from top-3 tags, ranked)
   - Blends with IG dark/light theme: transparent rows, no white cards
   Works in search drawer (dialog/aside) AND full search page (main).
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

const APP_ID = "936619743392459";
const FETCH_TIMEOUT_MS = 9000;

let activeTab = "keyword";
let lastQuery = "";
let lastData = { users: [], hashtags: [], places: [], clips: [], related: [], _blocked: false };
let debounce = null;
let enabled = true;
let keywordFirst = true;
let boundInputs = new WeakSet();
let currentScope = null;
let enhanceTimer = null;
let aborter = null;
let searchSeq = 0;

init().catch(() => {});

async function init() {
  try {
    const s = await chrome.storage.sync.get({ enhancedSearch: true, keywordSearch: true });
    enabled = s.enhancedSearch !== false;
    keywordFirst = s.keywordSearch !== false;
    activeTab = keywordFirst ? "keyword" : "foryou";
  } catch {}
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area === "sync" && c.enhancedSearch) {
        enabled = c.enhancedSearch.newValue !== false;
        if (!enabled) cleanup();
        else queueEnhance(0);
      }
      if (area === "sync" && c.keywordSearch) {
        keywordFirst = c.keywordSearch.newValue !== false;
        // If user is on foryou/tags and flips the switch, jump to keyword.
        if (keywordFirst && (activeTab === "foryou" || activeTab === "tags")) activeTab = "keyword";
        syncActiveTab();
        renderIntoNative();
      }
    });
  } catch {}
  refreshPins().catch(() => {});
  if (!enabled) return;
  bindGlobalSearchKeys();
  bindResultNav();
  bindBoxActions();

  new MutationObserver((mutations) => {
    if (document.hidden) return;
    for (const m of mutations) {
      // Never react to our own subtree (was a major jank source).
      if (m.target?.closest?.("#inta-wrap, #inta-top-search, #inta-edit-helper, #inta-profile-bar, #inta-toast, #inta-lens, #inta-palette, #inta-search-overlay, #inta-settings")) continue;
      const added = [...(m.addedNodes || [])];
      const removed = [...(m.removedNodes || [])];
      if (!added.length && !removed.length) continue;
      if (added.some((n) => n.id === "inta-wrap" || n.querySelector?.("#inta-wrap"))) continue;
      // Only drawer/search-relevant changes: dialog, aside, nav, inputs.
      // Reacting to EVERY image/video load is what made clicks feel dead.
      const relevant = [...added, ...removed].some((n) => {
        if (n.nodeType !== 1) return false;
        if (n.matches?.('div[role="dialog"], aside, nav, input')) return true;
        return !!n.querySelector?.('div[role="dialog"], aside, nav, input[placeholder], input[aria-label]');
      });
      if (!relevant) continue;
      queueEnhance(600);
      return;
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  queueEnhance(400);
}

function queueEnhance(delay = 400) {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => {
    try {
      enhanceNative();
    } catch (e) {
      console.warn("[Inta-Enhancer] search enhance failed", e);
    }
  }, delay);
}

// Called by the Explore top-search pill. Drawer-first: focus any visible
// search field; only click nav as last resort; standalone overlay fallback
// guarantees Search ALWAYS opens even if IG renames its nav markup.
window.IntaOpenSearch = function (preset) {
  try {
    const existing = findSearchInput();
    if (existing) {
      if (preset) {
        try {
          existing.value = preset;
        } catch {}
      }
      existing.focus();
      try {
        existing.click();
      } catch {}
      if (preset) runSearch(preset);
      return true;
    }
    const nav = findSearchNav();
    if (nav) {
      try {
        nav.click();
      } catch {}
      // Poll for the drawer input (React renders async) then focus it.
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const inp = findSearchInput();
        if (inp) {
          clearInterval(timer);
          if (preset) {
            try {
              inp.value = preset;
            } catch {}
          }
          try {
            inp.focus();
            inp.click();
          } catch {}
          if (preset) runSearch(preset);
        } else if (tries >= 8) {
          clearInterval(timer);
          openOverlay(preset); // nav click rendered nothing -> overlay
        }
      }, 250);
      return true;
    }
    openOverlay(preset); // no nav found at all -> overlay
    return true;
  } catch {
    try {
      openOverlay(preset);
    } catch {}
    return true;
  }
};

/* Standalone overlay: our own search panel. Independent of IG's drawer,
   so Search works even when Instagram changes/removes its markup. */
function openOverlay(preset) {
  try {
    let ov = document.getElementById("inta-search-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "inta-search-overlay";
      ov.innerHTML = `
        <div class="inta-ov-backdrop" data-ov-close="1"></div>
        <div class="inta-ov-panel" role="dialog" aria-label="Inta search">
          <div class="inta-ov-head">
            <span class="inta-ov-title">${ic("spark", 16)}<span>Search</span></span>
            <button type="button" class="inta-ov-x" data-ov-close="1" aria-label="Close">${ic("x", 14)}</button>
          </div>
          <input id="inta-ov-input" type="text" placeholder="Search by keyword — accounts, posts, reels…" autocomplete="off" />
          <div id="inta-ov-tabs"></div>
          <div id="inta-ov-results" class="inta-results"></div>
        </div>`;
      document.documentElement.appendChild(ov);
      ov.addEventListener("click", (e) => {
        if (e.target.closest?.("[data-ov-close]")) {
          closeOverlay();
        }
      });
      const inp = ov.querySelector("#inta-ov-input");
      if (inp && !boundInputs.has(inp)) {
        boundInputs.add(inp);
        inp.addEventListener("input", onType);
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeOverlay();
          } else {
            onEnter(e);
          }
        });
      }
      const tabsHost = ov.querySelector("#inta-ov-tabs");
      if (tabsHost && !tabsHost.querySelector("#inta-tabs")) {
        tabsHost.appendChild(buildTabs());
      }
    } else {
      const tabsHost = ov.querySelector("#inta-ov-tabs");
      if (tabsHost && !tabsHost.querySelector("#inta-tabs")) tabsHost.appendChild(buildTabs());
      else syncActiveTab();
    }
    ov.style.display = "block";
    const inp = ov.querySelector("#inta-ov-input");
    if (typeof preset === "string" && preset) {
      try {
        inp.value = preset;
      } catch {}
      runSearch(preset);
    } else if (lastQuery && inp && !inp.value) {
      try {
        inp.value = lastQuery;
      } catch {}
    }
    renderIntoNative();
    setTimeout(() => {
      try {
        inp?.focus();
      } catch {}
    }, 60);
  } catch (e) {
    console.warn("[Inta-Enhancer] overlay failed", e);
  }
}

function closeOverlay() {
  try {
    document.getElementById("inta-search-overlay")?.remove();
  } catch {}
}

// Robust Search-nav finder: IG changes markup often, so try aria-label,
// title, svg label, then text match — never exact-innerText-only.
function findSearchNav() {
  try {
    const visible = (el) => {
      if (!el || el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 20;
    };
    const clickables = [...document.querySelectorAll(
      'nav a, nav div[role="link"], nav div[role="button"], div[role="dialog"] ~ * a, a[aria-label], div[aria-label]'
    )];
    // 1. aria-label / title exact
    let hit = clickables.find(
      (el) =>
        (el.getAttribute("aria-label") || "").toLowerCase() === "search" ||
        (el.getAttribute("title") || "").toLowerCase() === "search"
    );
    if (hit && visible(hit)) return hit;
    // 2. svg with search label -> closest clickable
    const svg = document.querySelector('nav svg[aria-label="Search"], svg[aria-label="Search"]');
    if (svg) {
      const c = svg.closest("a, div[role='link'], div[role='button'], button");
      if (c && visible(c)) return c;
    }
    // 3. leaf span/div whose own text is exactly "Search"
    const all = [...document.querySelectorAll("nav span, nav div")];
    for (const el of all) {
      if ((el.innerText || "").trim().toLowerCase() !== "search") continue;
      if (el.children.length !== 0) continue; // leaf only (avoids whole-nav match)
      const c = el.closest("a, div[role='link'], div[role='button']") || el;
      if (visible(c)) return c;
    }
    return null;
  } catch {
    return null;
  }
}

function cleanup() {
  try {
    aborter?.abort();
  } catch {}
  document.getElementById("inta-wrap")?.remove();
  document.getElementById("inta-search-overlay")?.remove();
  boundInputs = new WeakSet();
  currentScope = null;
}

/* ---------- FIND (drawer OR search page) ---------- */

function findSearchInput() {
  try {
    const all = [...document.querySelectorAll('input[type="text"], input:not([type])')];
    const visible = all.filter((i) => {
      if (i.closest("#inta-wrap, #inta-top-search, #inta-edit-helper, #inta-search-overlay, #inta-palette, #inta-settings")) return false;
      if (i.hasAttribute("data-meta-input")) return false; // our own Ask box
      if (i.classList?.contains("inta-set-filter")) return false; // hub filter
      if (i.closest(".inta-meta")) return false;
      if (i.offsetParent === null) return false;
      const r = i.getBoundingClientRect();
      return r.width > 120 && r.height > 10;
    });
    const scored = visible
      .map((i) => {
        const label = ((i.getAttribute("aria-label") || "") + " " + (i.placeholder || "")).toLowerCase();
        const inDrawer = i.closest('div[role="dialog"], aside') ? 2 : 0;
        const isSearch = label.includes("search") ? 3 : 0;
        return { i, score: inDrawer + isSearch };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.i || null;
  } catch {
    return null;
  }
}

function findScope(input) {
  if (!input) return null;
  try {
    // Never fall back to body — body-width anchoring is what pushed our
    // box below all native results at full-page width (the misalignment).
    return (
      input.closest('div[role="dialog"]') ||
      input.closest("aside") ||
      input.closest("main") ||
      input.closest("section") ||
      input.parentElement
    );
  } catch {
    return null;
  }
}

// Nearest ancestor spanning ~full scope width = the header row.
// Inserting after it = always BELOW the search bar.
function findHeaderBlock(scope, input) {
  try {
    let el = input.parentElement;
    while (el && el !== scope) {
      if (el.parentElement === scope) return el;
      try {
        if (scope.offsetWidth && el.offsetWidth >= scope.offsetWidth * 0.7) return el;
      } catch {}
      el = el.parentElement;
    }
  } catch {}
  return null;
}

/* ---------- INJECT ---------- */

function enhanceNative() {
  if (!enabled) return;
  const input = findSearchInput();
  if (!input) return;

  // Gate: the panel lives ONLY where search actually lives — an OPEN
  // search drawer/dialog, or Explore pages. Otherwise the tabs follow
  // you onto Home/Reels/Profile (the reported bug). The standalone
  // overlay is user-opened, so it always keeps rendering.
  const p = location.pathname || "/";
  const onExplore = p.startsWith("/explore");
  const dlg = input.closest('div[role="dialog"], aside');
  let drawerOpen = false;
  try {
    if (dlg && dlg.offsetParent !== null) {
      const r = dlg.getBoundingClientRect();
      drawerOpen = r.width > 200 && r.height > 100;
    }
  } catch {}
  if (!drawerOpen && !onExplore) {
    // Tear down a lingering panel when leaving search contexts.
    try { document.getElementById("inta-wrap")?.remove(); } catch {}
    currentScope = null;
    return;
  }

  const scope = findScope(input);
  if (!scope) return;

  if (currentScope && !currentScope.isConnected) currentScope = null;
  if (currentScope && currentScope !== scope) currentScope = null;

  if (!boundInputs.has(input)) {
    boundInputs.add(input);
    input.addEventListener("input", onType);
    input.addEventListener("keydown", onEnter);
    const v = (input.value || "").trim();
    if (v !== lastQuery) runSearch(v);
  }

  let wrap = scope.querySelector(":scope > #inta-wrap") || document.getElementById("inta-wrap");
  // Reposition on EVERY enhance: Instagram re-renders native results above/
  // below us on each keystroke — without this we drift to the bottom
  // (the bug in the screenshot: our box under all native rows, full width).
  // FIX: never return invisible — if the header row can't be found (IG
  // renamed markup), anchor to the top of the scope so the panel ALWAYS shows.
  const header = findHeaderBlock(scope, input);
  if (!wrap || !wrap.isConnected) {
    wrap = document.createElement("div");
    wrap.id = "inta-wrap";
    wrap.setAttribute("data-inta", "1");
    try {
      if (header) header.after(wrap);
      else if (scope.prepend) scope.prepend(wrap);
      else scope.appendChild(wrap);
    } catch { try { scope.appendChild(wrap); } catch {} }
  } else if (header && wrap.previousElementSibling !== header) {
    header.after(wrap); // move back directly below the search bar
  } else if (!header && wrap.parentElement !== scope) {
    try { if (scope.prepend) scope.prepend(wrap); } catch {}
  }
  // Align width with the search column (not full page): match the header
  // width so our tabs/cards line up with IG's own result rows.
  try {
    const w = Math.min((header || scope).offsetWidth || 0, 800);
    if (w >= 280) {
      wrap.style.maxWidth = w + "px";
      wrap.style.marginLeft = "auto";
      wrap.style.marginRight = "auto";
    }
  } catch {}

  // Self-heal: older DOM from a previous version has no Keyword tab.
  if (!wrap.querySelector('#inta-tabs [data-tab="keyword"]')) {
    wrap.querySelector("#inta-tabs")?.remove();
  }
  // Guard against stale tab values from older versions.
  const knownTabs = ["keyword", "foryou", "accounts", "reels", "audio", "tags"];
  if (!knownTabs.includes(activeTab)) activeTab = keywordFirst ? "keyword" : "foryou";
  if (!wrap.querySelector("#inta-tabs")) wrap.appendChild(buildTabs());
  else syncActiveTab();
  if (!wrap.querySelector("#inta-native-results")) {
    const box = document.createElement("div");
    box.id = "inta-native-results";
    box.className = "inta-results";
    wrap.appendChild(box);
  }
  currentScope = scope;
  renderIntoNative();
}

function buildTabs() {
  const tabs = document.createElement("div");
  tabs.id = "inta-tabs";
  tabs.setAttribute("role", "tablist");
  const defs = [
    ["keyword", "Keyword"],
    ["foryou", "For you"],
    ["accounts", "Accounts"],
    ["reels", "Reels"],
    ["audio", "Audio"],
    ["tags", "Tags"],
  ];
  for (const [key, label] of defs) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tab = key;
    b.textContent = label;
    b.setAttribute("role", "tab");
    if (key === activeTab) {
      b.classList.add("active");
      b.setAttribute("aria-selected", "true");
    }
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      activeTab = key;
      syncActiveTab();
      renderIntoNative();
    });
    tabs.appendChild(b);
  }
  return tabs;
}

function syncActiveTab() {
  document.querySelectorAll("#inta-tabs button").forEach((x) => {
    const on = x.dataset.tab === activeTab;
    x.classList.toggle("active", on);
    if (on) x.setAttribute("aria-selected", "true");
    else x.removeAttribute("aria-selected");
  });
  updateTabCounts();
}

// Advanced: live result counts in tab labels (accounts/tags only when known).
function updateTabCounts() {
  try {
    const u = (lastData.users || []).length;
    const h = (lastData.hashtags || []).length;
    document.querySelectorAll("#inta-tabs button").forEach((b) => {
      const base = { keyword: "Keyword", foryou: "For you", accounts: "Accounts", reels: "Reels", audio: "Audio", tags: "Tags" }[b.dataset.tab] || b.dataset.tab;
      if (b.dataset.tab === "accounts" && u > 0 && lastQuery) b.textContent = `${base} (${u > 8 ? "8+" : u})`;
      else if (b.dataset.tab === "tags" && h > 0 && lastQuery) b.textContent = `${base} (${h > 8 ? "8+" : h})`;
      else b.textContent = base;
    });
  } catch {}
}

function onType(e) {
  clearTimeout(debounce);
  const v = (e.target.value || "").trim();
  debounce = setTimeout(() => {
    if (v !== lastQuery) runSearch(v);
  }, 450);
}
function onEnter(e) {
  // Search in place: never let Enter fall through to Instagram's own
  // submit (it navigates away to dead-end routes).
  if (e.key === "Enter" && (e.target.value || "").trim()) {
    e.preventDefault();
    try { e.stopPropagation(); } catch {}
    runSearch(e.target.value.trim());
  }
}

/* ---------- Keyboard nav: ArrowDown from the field into results,
   arrows between rows, ArrowUp back to the field. Enter works
   natively on the focused link/button — never hijacked. ---------- */
let resultNavBound = false;
function bindResultNav() {
  if (resultNavBound) return;
  resultNavBound = true;
  document.addEventListener("keydown", (e) => {
    try {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const field = t?.matches?.("input") &&
        (t === findSearchInput() || t?.hasAttribute?.("data-meta-input") || t?.id === "inta-ov-input")
        ? t : null;
      const row = !field ? t?.closest?.("a.inta-row, button.inta-ask, button.inta-pill") : null;
      if (!field && !row) return;
      const rows = [...document.querySelectorAll(".inta-results a.inta-row, .inta-results button.inta-ask, .inta-results button.inta-pill")]
        .filter((el) => el.isConnected && el.offsetParent !== null);
      if (!rows.length) return;
      if (field && e.key === "ArrowDown") {
        e.preventDefault();
        rows[0].focus();
        return;
      }
      if (row) {
        const i = rows.indexOf(row);
        if (i < 0) return;
        if (e.key === "ArrowDown" && i < rows.length - 1) {
          e.preventDefault();
          rows[i + 1].focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          if (i > 0) rows[i - 1].focus();
          else {
            const f = findSearchInput() || document.getElementById("inta-ov-input");
            try { f?.focus(); } catch {}
          }
        }
      }
    } catch {}
  });
}

/* ---------- ADVANCED: cache, recents, keys, actions ---------- */

const queryCache = new Map(); // q -> { at, data }
const CACHE_TTL_MS = 5 * 60 * 1000;
function cacheGet(q) {
  try {
    const hit = queryCache.get(q);
    if (!hit) return null;
    if (Date.now() - hit.at > CACHE_TTL_MS) {
      queryCache.delete(q);
      return null;
    }
    return hit.data;
  } catch {
    return null;
  }
}
function cacheSet(q, data) {
  try {
    queryCache.set(q, { at: Date.now(), data });
    if (queryCache.size > 30) {
      const first = queryCache.keys().next().value;
      queryCache.delete(first);
    }
  } catch {}
}

async function loadRecents() {
  try {
    const s = await chrome.storage.local.get({ intaRecents: [] });
    return Array.isArray(s.intaRecents) ? s.intaRecents.slice(0, 8) : [];
  } catch {
    return [];
  }
}
async function saveRecent(q) {
  try {
    q = String(q || "").trim();
    if (!q) return;
    const cur = await loadRecents();
    const next = [q, ...cur.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    await chrome.storage.local.set({ intaRecents: next });
  } catch {}
}

/* ---------- Pinned searches (advanced) ---------- */

let pinnedCache = [];
async function loadPins() {
  try {
    const s = await chrome.storage.local.get({ intaPins: [] });
    return Array.isArray(s.intaPins) ? s.intaPins.slice(0, 8) : [];
  } catch {
    return [];
  }
}
async function refreshPins() {
  pinnedCache = await loadPins();
}
function isPinned(q) {
  try {
    return pinnedCache.some((x) => String(x).toLowerCase() === String(q || "").toLowerCase());
  } catch {
    return false;
  }
}
async function togglePin(q) {
  try {
    q = String(q || "").trim();
    if (!q) return false;
    const cur = await loadPins();
    const has = cur.some((x) => String(x).toLowerCase() === q.toLowerCase());
    const next = has
      ? cur.filter((x) => String(x).toLowerCase() !== q.toLowerCase())
      : [q, ...cur].slice(0, 8);
    await chrome.storage.local.set({ intaPins: next });
    pinnedCache = next;
    return !has;
  } catch {
    return false;
  }
}

// One document-level delegation for retry + recent pills (survives re-renders).
let boxActionsBound = false;
function bindBoxActions() {
  if (boxActionsBound) return;
  boxActionsBound = true;
  document.addEventListener("click", (e) => {
    const send = e.target.closest?.("[data-meta-send]");
    if (send) {
      e.preventDefault();
      e.stopPropagation();
      try {
        const card = send.closest(".inta-meta");
        const inp = card?.querySelector("[data-meta-input]");
        const q = (inp?.value || "").trim();
        if (q) { setAllSearchInputs(q); runSearch(q); }
      } catch {}
      return;
    }
    const retry = e.target.closest?.("[data-retry]");
    if (retry) {
      e.preventDefault();
      e.stopPropagation();
      runSearch(lastQuery);
      return;
    }
    const recent = e.target.closest?.("[data-recent]");
    if (recent) {
      e.preventDefault();
      e.stopPropagation();
      const q = recent.dataset.recent || "";
      setAllSearchInputs(q);
      runSearch(q);
      return;
    }
    // Pin / unpin (pins live in storage.local, survive re-renders).
    const pin = e.target.closest?.("[data-pin]");
    if (pin) {
      e.preventDefault();
      e.stopPropagation();
      togglePin(pin.dataset.pin || lastQuery).then(() => renderIntoNative());
      return;
    }
    const unpin = e.target.closest?.("[data-unpin]");
    if (unpin) {
      e.preventDefault();
      e.stopPropagation();
      togglePin(unpin.dataset.unpin || "").then(() => renderIntoNative());
      return;
    }
    const clear = e.target.closest?.("[data-clear-recents]");
    if (clear) {
      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.storage.local.set({ intaRecents: [] }).then(
          () => renderIntoNative(),
          () => renderIntoNative()
        );
      } catch {
        renderIntoNative();
      }
      return;
    }
    // Ask pills search in place (no dead /explore/search/ navigation).
    const ask = e.target.closest?.("[data-ask]");
    if (ask) {
      e.preventDefault();
      e.stopPropagation();
      const q = ask.dataset.ask || "";
      setAllSearchInputs(q);
      runSearch(q);
    }
  });
  document.addEventListener("keydown", (e) => {
    try {
      const inp = e.target?.closest?.("[data-meta-input]");
      if (inp && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const q = (inp.value || "").trim();
        if (q) { setAllSearchInputs(q); runSearch(q); }
      }
    } catch {}
  }, true);
}

function setAllSearchInputs(q) {
  try {
    const drawer = findSearchInput();
    if (drawer) drawer.value = q;
  } catch {}
  try {
    const ov = document.getElementById("inta-ov-input");
    if (ov) ov.value = q;
  } catch {}
}

// "/" focuses search (when not typing), Escape blurs it.
let keysBound = false;
function bindGlobalSearchKeys() {
  if (keysBound) return;
  keysBound = true;
  document.addEventListener("keydown", (e) => {
    try {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t?.matches?.("input, textarea, select, [contenteditable], [role='textbox']");
      if (e.key === "/" && !typing) {
        const inp = findSearchInput();
        if (inp) {
          e.preventDefault();
          window.IntaOpenSearch?.();
          setTimeout(() => {
            try {
              inp.focus();
            } catch {}
          }, 300);
        }
      } else if (e.key === "Escape" && typing && t === findSearchInput()) {
        t.blur();
      }
    } catch {}
  });
}

function renderSkeleton() {
  const html = `<div class="inta-sec">Searching…</div>` + `<div class="inta-sk"></div>`.repeat(4);
  let any = false;
  document.querySelectorAll(".inta-results").forEach((box) => {
    if (box.isConnected) {
      box.innerHTML = html;
      any = true;
    }
  });
  if (!any) document.getElementById("inta-native-results")?.replaceChildren();
}

/* ---------- FETCH ---------- */

function getCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : "";
}
function headers() {
  return { "x-ig-app-id": APP_ID, "x-requested-with": "XMLHttpRequest", "x-csrftoken": getCsrf() };
}
async function fetchJson(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "include", headers: headers(), signal: signal || ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
async function fetchTopSearch(query, signal) {
  const rank = Math.random().toString(36).slice(2);
  return fetchJson(
    "https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=" +
      encodeURIComponent(query) + "&rank_token=" + rank + "&include_reel=true",
    signal
  );
}
async function fetchTagClips(tagName, signal, perTag = 3) {
  try {
    const j = await fetchJson(
      "https://www.instagram.com/api/v1/tags/web_info/?tag_name=" + encodeURIComponent(tagName),
      signal
    );
    // Shape varies by account/region: try known paths first, then deep-scan
    // for any {code, image_versions2} media objects as a last resort.
    const sections = j?.data?.top_posts?.sections || j?.data?.recent_posts?.sections || j?.top_posts?.sections || [];
    let medias = sections.flatMap((s) => s?.layout_content?.medias || s?.feed_results || []);
    let out = [];
    const seen = new Set();
    for (const m of medias) {
      const media = m?.media || m;
      const code = media?.code;
      const thumb = media?.image_versions2?.candidates?.[0]?.url || "";
      if (!code || !thumb || seen.has(code)) continue;
      seen.add(code);
      out.push({
        code,
        thumb,
        likes: media?.like_count || 0,
        tag: tagName,
      });
      if (out.length >= perTag) break;
    }
    if (!out.length) out = deepScanClips(j, tagName, perTag);
    return out;
  } catch {
    return [];
  }
}

// Last-resort scan: walk the JSON for anything shaped like a reel/post.
function deepScanClips(root, tagName, perTag = 3) {
  const out = [];
  const seen = new Set();
  try {
    const stack = [root];
    let steps = 0;
    while (stack.length && out.length < perTag && steps < 4000) {
      steps += 1;
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (Array.isArray(cur)) {
        for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
        continue;
      }
      const code = cur.code;
      const cands = cur.image_versions2?.candidates;
      if (typeof code === "string" && code.length >= 5 && Array.isArray(cands) && cands[0]?.url && !seen.has(code)) {
        seen.add(code);
        out.push({ code, thumb: cands[0].url, likes: cur.like_count || 0, tag: tagName });
        if (out.length >= perTag) break;
      }
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
  } catch {}
  return out;
}
async function fetchSuggestedReels(tagNames, signal) {
  const names = [...new Set((tagNames || []).filter(Boolean))].slice(0, 3);
  if (!names.length) return [];
  const lists = await Promise.all(names.map((t) => fetchTagClips(t, signal, 3)));
  const seen = new Set();
  const all = [];
  for (const list of lists) for (const c of list) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    all.push(c);
  }
  all.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  return all.slice(0, 6);
}

async function runSearch(q) {
  lastQuery = q;
  // Keyword-first: every NEW query opens on the Keyword tab (the requested
  // behavior: "search gives keyword output instead of hashtag output").
  // Clicking another tab after that still sticks until the next query.
  if (q && keywordFirst && activeTab !== "keyword") {
    activeTab = "keyword";
    try { syncActiveTab(); } catch {}
  }
  const mySeq = ++searchSeq;
  try {
    aborter?.abort();
  } catch {}
  aborter = new AbortController();
  const { signal } = aborter;
  if (!q) {
    lastData = { users: [], hashtags: [], places: [], clips: [], related: [], _blocked: false };
    renderIntoNative();
    return;
  }
  const cached = cacheGet(q);
  if (cached) {
    lastData = cached;
    renderIntoNative();
    return;
  }
  renderSkeleton();
  try {
    const data = await fetchTopSearch(q, signal);
    if (mySeq !== searchSeq || signal.aborted) return;
    lastData = {
      users: Array.isArray(data.users) ? data.users : [],
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
      places: Array.isArray(data.places) ? data.places : [],
      clips: [],
      related: [],
      _blocked: false,
    };
    const topTags = lastData.hashtags.slice(0, 3).map((h) => h.hashtag?.name).filter(Boolean);
    lastData.related = topTags;
    if (topTags.length) lastData.clips = await fetchSuggestedReels(topTags, signal);
    cacheSet(q, lastData);
    saveRecent(q);
  } catch (err) {
    if (err?.name === "AbortError") return;
    lastData = { users: [], hashtags: [], places: [], clips: [], related: [], _blocked: true };
  }
  if (mySeq === searchSeq) renderIntoNative();
}

/* ---------- Teen-filter notice (Instagram-side block) ----------
   When IG predicts the account is a teen, it hides most results for
   many queries ("Age-inappropriate results hidden for predicted
   teens") and its own list shows "Failed to load." That block is
   server-side — our API calls get filtered too, and no extension can
   (or should) bypass teen safety. We just detect the notice and say
   so inline, with the actual workaround (full @username / #tag). */
let teenCache = { at: 0, val: false };
function teenFilterActive() {
  try {
    const now = Date.now();
    if (now - teenCache.at < 4000) return teenCache.val;
    teenCache.at = now;
    const main = document.querySelector("main");
    const t = (main?.innerText || "").toLowerCase();
    teenCache.val = t.includes("predicted teens") || t.includes("age-inappropriate");
    return teenCache.val;
  } catch {
    return false;
  }
}

/* ---------- RENDER (native dark, like mobile screenshot) ---------- */

function renderIntoNative() {
  updateTabCounts();
  const boxes = [...document.querySelectorAll(".inta-results")].filter((b) => b.isConnected);
  const native = document.getElementById("inta-native-results");
  if (native && native.isConnected && !boxes.includes(native)) boxes.push(native);
  if (!boxes.length) return;
  const q = lastQuery;
  if (!q) {
    boxes.forEach((b) => {
      b.innerHTML = `<div class="inta-hint">Type to search…</div>`;
    });
    loadRecents().then((recents) => {
      if (lastQuery) return; // user typed meanwhile
      loadPins().then((pins) => {
        if (lastQuery) return;
        const pinHtml = (pins || []).length
          ? `<div class="inta-sec">Pinned</div><div class="inta-pills">` + pins.map((r) =>
              `<button type="button" class="inta-pill" data-recent="${escAttr(r)}">${esc(r)}</button><button type="button" class="inta-unpin" data-unpin="${escAttr(r)}" title="Unpin">×</button>`).join("") + `</div>`
          : "";
        const html = pinHtml + (recents.length
          ? `<div class="inta-sec">Recent</div><div class="inta-pills">` + recents.map((r) =>
              `<button type="button" class="inta-pill" data-recent="${escAttr(r)}">${esc(r)}</button>`).join("") + `</div>`
            + `<div><button type="button" class="inta-pinbtn" data-clear-recents="1">Clear recent</button></div>`
            + `<div class="inta-hint">Type to search — press <b>/</b> anytime to jump here. <b>↓</b> moves into results.</div>`
          : (pinHtml ? "" : `<div class="inta-hint">Type to search — results blend with Instagram's own list below.<br>Press <b>/</b> anytime to jump here.</div>`));
        document.querySelectorAll(".inta-results").forEach((b) => {
          if (b.isConnected && !lastQuery) b.innerHTML = html;
        });
      });
    });
    return;
  }
  const clean = q.replace(/^[@#]/, "").trim();
  const noSpace = clean.replace(/\s+/g, "");
  const tagUrl = noSpace ? "/explore/tags/" + encodeURIComponent(noSpace) + "/" : null;
  const keywordUrl = clean ? "/explore/search/?q=" + encodeURIComponent(clean) : null;

  let html = "";
  if (teenFilterActive() && q)
    html += `<div class="inta-warn">Instagram hid most results for this search (teen safety filter on this account) — not our block. Try the full @username or a #tag instead.</div>`;
  if (lastData._blocked)
    html += `<div class="inta-warn">Live previews limited — links below always work. <button type="button" class="inta-retry" data-retry="1">Retry</button></div>`;

  if (activeTab === "keyword") {
    html += keywordSection(clean, noSpace, tagUrl, keywordUrl);
  } else if (activeTab === "foryou") {
    const places = placeRows(2);
    // Keyword-first: direct keyword links come before the #tag conversion.
    html += aiCard(clean, noSpace, tagUrl, keywordUrl) + keywordDirectRows(clean, keywordUrl, tagUrl, noSpace) + reelsGrid(false, tagUrl, noSpace) + rowSection("Accounts", accountRows(3, noSpace)) + rowSection("Tags", tagRows(3, tagUrl, noSpace)) + (places ? rowSection("Places", places) : "");
  }
  else if (activeTab === "accounts") html += rowSection("Accounts", accountRows(8, noSpace));
  else if (activeTab === "reels") html += reelsGrid(true, tagUrl, noSpace) + relatedPills();
  else if (activeTab === "audio") html += audioSection(clean, noSpace);
  else if (activeTab === "tags") html += rowSection("Tags", tagRows(8, tagUrl, noSpace));

  boxes.forEach((b) => {
    b.innerHTML = html;
  });
}

function aiCard(clean, noSpace, tagUrl, keywordUrl) {
  // Meta AI default style (like mobile): gradient ring, "Search with Meta AI",
  // conversational summary + Ask box. All data is LIVE from topsearch.
  const u = (lastData.users || []).length;
  const h = (lastData.hashtags || []).length;
  const p = (lastData.places || []).length;
  const topUser = lastData.users?.[0]?.user;
  const topTag = lastData.hashtags?.[0]?.hashtag;
  const topPlace = lastData.places?.[0]?.place;
  const totalClips = (lastData.clips || []).length;

  let answer;
  if (topTag || topUser) {
    answer = `Here's what I found for "<b>${esc(clean)}</b>" — `
      + `${u} account${u === 1 ? "" : "s"}, ${h} tag${h === 1 ? "" : "s"}`
      + (p ? `, ${p} place${p === 1 ? "" : "s"}` : "")
      + (totalClips ? ` and ${totalClips} top reel${totalClips === 1 ? "" : "s"}` : "")
      + `. `;
    if (topTag) answer += `Top tag <b>#${esc(topTag.name)}</b> has ${Number(topTag.media_count || 0).toLocaleString()} posts. `;
    if (topUser) answer += `Top account <b>@${esc(topUser.username)}</b>${topUser.full_name ? ` (${esc(topUser.full_name)})` : ""}${topUser.is_verified ? ' <span class="inta-verified">' + ic("check", 13) + "</span>" : ""}. `;
    if (topPlace?.title) answer += `Place: <b>${esc(topPlace.title)}</b>. `;
    answer += `Tap a result below or ask a follow-up.`;
  } else if (lastData._blocked) {
    answer = `Live previews are limited right now for "<b>${esc(clean)}</b>", but direct links below always work. Try Retry, or tap Reels / Accounts.`;
  } else {
    answer = `Showing best matches for "<b>${esc(clean)}</b>". Try the Reels tab for video, Accounts for people, Tags for hashtags.`;
  }

  const sources = [];
  if (keywordUrl) sources.push(`<a class="inta-src" href="${keywordUrl}">“${esc(clean)}” keyword</a>`);
  if (topTag && tagUrl) sources.push(`<a class="inta-src" href="${tagUrl}">#${esc(topTag.name)}</a>`);
  (lastData.related || []).slice(1, 3).forEach((t) =>
    sources.push(`<a class="inta-src" href="/explore/tags/${encodeURIComponent(t)}/">#${esc(t)}</a>`));
  if (topUser) sources.push(`<a class="inta-src" href="/${encodeURIComponent(topUser.username)}/">@${esc(topUser.username)}</a>`);

  const asks = [
    `<button type="button" class="inta-ask" data-ask="${escAttr(clean + " reels")}">${ic("spark", 12)}<span>${esc(clean)} reels</span></button>`,
    `<button type="button" class="inta-ask" data-ask="${escAttr("best of " + clean)}">${ic("spark", 12)}<span>best of ${esc(clean)}</span></button>`,
    `<button type="button" class="inta-ask" data-ask="${escAttr(noSpace || clean)}">${esc(noSpace ? "#" + noSpace + " latest" : "Trending now")}</button>`,
  ];
  return `<div class="inta-ai inta-meta">`
    + `<div class="inta-meta-head"><span class="inta-meta-logo" aria-hidden="true"><svg viewBox="0 0 36 36" width="18" height="18"><defs><linearGradient id="intamg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0082FB"/><stop offset=".5" stop-color="#786EFD"/><stop offset="1" stop-color="#E940DF"/></linearGradient></defs><path fill="url(#intamg)" d="M18 7c-2.6 0-4.2 1.4-5.6 2.8C10.9 11.2 9.4 12.6 7 12.6c-2.9 0-5 2.4-5 5.4s2.1 5.4 5 5.4c2.4 0 3.9-1.4 5.4-2.8C13.8 19.2 15.4 17.8 18 17.8s4.2 1.4 5.6 2.8c1.5 1.4 3 2.8 5.4 2.8 2.9 0 5-2.4 5-5.4s-2.1-5.4-5-5.4c-2.4 0-3.9 1.4-5.4 2.8C22.2 8.4 20.6 7 18 7zm-11 8.1c1.4 0 2.3.9 3.5 2.1 1.3 1.3 2.8 2.7 4.4 3.5-1 .5-2 1-3 1.6-1.1.6-2 1-2.9 1-1.6 0-2.7-1.3-2.7-3s1.1-3 2.7-3.1l-2-.1zm22 0c1.6 0 2.7 1.3 2.7 3s-1.1 3-2.7 3c-.9 0-1.8-.4-2.9-1-1-.6-2-1.1-3-1.6 1.6-.8 3.1-2.2 4.4-3.5 1.2-1.2 2.1-2.1 3.5-2.1l-2 .2z"/></svg></span>`
    + `<span class="inta-meta-title">Search with Meta AI</span><span class="inta-meta-live">default</span></div>`
    + `<div class="inta-ai-body inta-meta-answer">${answer}</div>`
    + `<div class="inta-meta-askrow"><input type="text" class="inta-meta-input" placeholder="Ask Meta AI a follow-up…" aria-label="Ask Meta AI" data-meta-input="1" /><button type="button" class="inta-meta-send" data-meta-send="1" title="Ask">${ic("send", 15)}</button></div>`
    + `<div class="inta-asks">${asks.join("")}</div>`
    + `<div><button type="button" class="inta-pinbtn${isPinned(clean) ? " on" : ""}" data-pin="${escAttr(clean)}">${isPinned(clean) ? "Pinned" : "Pin this search"}</button></div>`
    + (sources.length ? `<div class="inta-sources">Sources ${sources.join(" ")}</div>` : "")
    + `</div>`;
}

function reelsGrid(full, tagUrl, noSpace) {
  // Always show the section: live thumbnails when the API allows, else
  // one-tap link cards (tag reels grid + trending) that always work.
  let html = `<div class="inta-sec">Reels</div>`;
  if (lastData.clips?.length) {
    const clips = full ? lastData.clips : lastData.clips.slice(0, 6);
    html += `<div class="inta-reel-grid">` + clips.map((c) =>
      `<a href="/reel/${encodeURIComponent(c.code)}/" class="inta-reel" title="#${esc(c.tag || "")}"><img src="${escAttr(c.thumb)}" loading="lazy" referrerpolicy="no-referrer" draggable="false" alt="" /><span>${ic("play", 10)} ${fmt(c.likes)}</span></a>`
    ).join("") + `</div>`;
  }
  if (tagUrl && noSpace) {
    html += `<a class="inta-row" href="${tagUrl}"><span class="inta-ic">${ic("film", 20)}</span><span class="inta-txt"><span class="inta-t1">Reels for #${esc(noSpace)}</span><span class="inta-t2">tap Reels filter — same as app</span></span></a>`;
  }
  html += `<a class="inta-row" href="/reels/"><span class="inta-ic">${ic("play", 20)}</span><span class="inta-txt"><span class="inta-t1">Trending Reels</span><span class="inta-t2">instagram.com/reels</span></span></a>`;
  return html;
}

function relatedPills() {
  if (!lastData.related?.length) return "";
  return `<div class="inta-pills">` + lastData.related.map((t) =>
    `<a class="inta-pill" href="/explore/tags/${encodeURIComponent(t)}/">#${esc(t)}</a>`).join("") + `</div>`;
}

function accountRows(lim, noSpace) {
  const users = (lastData.users || []).slice(0, lim);
  if (users.length) return users.map((u) => {
    const user = u.user || {};
    const name = user.username || "?";
    // Letter avatar only: CDN <img> is flaky on web (CORP blocks, see
    // console ERR_BLOCKED_BY_RESPONSE) and inline onerror violates IG's
    // CSP. Letters always render and never break the layout.
    return `<a class="inta-row" href="/${encodeURIComponent(user.username || "")}/">`
      + `<span class="inta-ic">${esc(name.charAt(0).toUpperCase())}</span>`
      + `<span class="inta-txt"><span class="inta-t1">${esc(name)} ${user.is_verified ? '<span class="inta-verified">' + ic("check", 13) + "</span>" : ""}</span>`
      + `<span class="inta-t2">${esc(user.full_name || "")}</span></span></a>`;
  }).join("");
  return noSpace ? `<a class="inta-row" href="/${encodeURIComponent(noSpace)}/"><span class="inta-ic">${ic("user", 20)}</span><span class="inta-txt"><span class="inta-t1">@${esc(noSpace)}</span><span class="inta-t2">open profile directly</span></span></a>` : "";
}

function tagRows(lim, tagUrl, noSpace) {
  const tags = (lastData.hashtags || []).slice(0, lim);
  let html = tags.length ? tags.map((h) => {
    const t = h.hashtag || {};
    return `<a class="inta-row" href="/explore/tags/${encodeURIComponent(t.name || "")}/">`
      + `<span class="inta-ic">#</span>`
      + `<span class="inta-txt"><span class="inta-t1">#${esc(t.name || "")}</span>`
      + `<span class="inta-t2">${Number(t.media_count || 0).toLocaleString()} posts</span></span></a>`;
  }).join("") : "";
  if (tagUrl) html += `<a class="inta-row" href="${tagUrl}"><span class="inta-ic">${ic("external", 18)}</span><span class="inta-txt"><span class="inta-t1">#${esc(noSpace)}</span><span class="inta-t2">photos + reels grid</span></span></a>`;
  return html;
}

function audioSection(clean, noSpace) {
  // No public audio-search API on web — mirror mobile by surfacing reels
  // (which carry the trending audio) + a direct audio-search link.
  const audioUrl = "/explore/search/?q=" + encodeURIComponent((clean || "") + " audio");
  return `<div class="inta-sec">Audio</div>`
    + (lastData.clips?.length ? reelsGrid(true) : `<div class="inta-empty">No audio previews yet — try a link below.</div>`)
    + `<a class="inta-row" href="${audioUrl}"><span class="inta-ic">${ic("music", 20)}</span><span class="inta-txt"><span class="inta-t1">${esc(clean)} audio</span><span class="inta-t2">trending sounds for this search</span></span></a>`;
}

function placeRows(lim) {
  const places = (lastData.places || []).slice(0, lim);
  if (!places.length) return "";
  return places.map((p) => {
    const pl = p.place || {};
    const title = pl.title || pl.name || "Place";
    const sub = pl.subtitle || pl.address || "";
    const inner = `<span class="inta-ic">${ic("search", 18)}</span><span class="inta-txt"><span class="inta-t1">${esc(title)}</span>${sub ? `<span class="inta-t2">${esc(sub)}</span>` : ""}</span>`;
    const id = pl.id ?? pl.pk ?? pl.location_id ?? pl.pk_id;
    if (id != null && String(id)) {
      return `<a class="inta-row" href="/explore/locations/${encodeURIComponent(String(id))}/">${inner}</a>`;
    }
    return `<span class="inta-row">${inner}</span>`;
  }).join("");
}

/* ---------- KEYWORD-FIRST search (not hashtag-only) ----------
   Instagram's topsearch API already takes a raw keyword query, but the old
   UI immediately collapsed "red shoes" -> "#redshoes" and pushed the user
   to /explore/tags/. Keyword mode keeps the raw words ("red shoes") as the
   primary result set:
   - direct keyword rows link to /explore/search/?q=<words> (IG keyword page)
   - live users/tags/places are re-ranked by keyword-token match, not by
     who has the closest hashtag name
   - the #tag grid stays available, but as a secondary row / Tags tab. */

function keywordTokens(clean) {
  return String(clean || "").toLowerCase().split(/[\s_]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
}

function keywordScore(hay, tokens) {
  try {
    const h = String(hay || "").toLowerCase();
    if (!h || !tokens.length) return 0;
    let score = 0;
    for (const t of tokens) {
      if (!t) continue;
      if (h === t) score += 10;
      else if (h.startsWith(t)) score += 6;
      else if (h.includes(t)) score += 3;
    }
    return score;
  } catch { return 0; }
}

function rankByKeyword(list, getText, clean) {
  try {
    const tokens = keywordTokens(clean);
    if (!tokens.length) return list;
    return [...list].sort((a, b) =>
      keywordScore(getText(b), tokens) - keywordScore(getText(a), tokens));
  } catch { return list; }
}

function keywordDirectRows(clean, keywordUrl, tagUrl, noSpace) {
  if (!clean) return "";
  let html = "";
  if (keywordUrl) {
    html += `<a class="inta-row" href="${keywordUrl}"><span class="inta-ic">${ic("search", 20)}</span><span class="inta-txt"><span class="inta-t1">“${esc(clean)}” — keyword results</span><span class="inta-t2">posts, reels & accounts matching these words</span></span></a>`;
  }
  if (tagUrl && noSpace && noSpace.toLowerCase() !== clean.toLowerCase().replace(/\s+/g, "")) {
    // Only reached when query had spaces/symbols — kept for reference.
  }
  if (tagUrl && noSpace) {
    html += `<a class="inta-row inta-alt" href="${tagUrl}"><span class="inta-ic">#</span><span class="inta-txt"><span class="inta-t1">#${esc(noSpace)}</span><span class="inta-t2">hashtag grid instead</span></span></a>`;
  }
  return html ? `<div class="inta-sec">Keyword</div>` + html : "";
}

function keywordSection(clean, noSpace, tagUrl, keywordUrl) {
  const tokens = keywordTokens(clean);
  const users = rankByKeyword(lastData.users || [], (u) =>
    ((u?.user?.username || "") + " " + (u?.user?.full_name || "")), clean).slice(0, 5);
  const tags = rankByKeyword(lastData.hashtags || [], (h) => (h?.hashtag?.name || ""), clean).slice(0, 5);

  // Single clear header with badge — no duplicate "Keyword" sections.
  let html = `<div class="inta-sec">Keyword — “${esc(clean)}” <span class="inta-kw-badge">words, not #tag</span></div>`;
  if (keywordUrl) {
    html += `<a class="inta-row inta-kw-main" href="${keywordUrl}"><span class="inta-ic">${ic("search", 20)}</span><span class="inta-txt"><span class="inta-t1">“${esc(clean)}” — keyword results</span><span class="inta-t2">posts, reels & accounts matching these words</span></span></a>`;
  }

  const userHtml = users.length ? users.map((u) => {
    const user = u.user || {};
    const name = user.username || "?";
    return `<a class="inta-row" href="/${encodeURIComponent(user.username || "")}/">`
      + `<span class="inta-ic">${esc(name.charAt(0).toUpperCase())}</span>`
      + `<span class="inta-txt"><span class="inta-t1">${esc(name)} ${user.is_verified ? '<span class="inta-verified">' + ic("check", 13) + "</span>" : ""}</span>`
      + `<span class="inta-t2">${esc(user.full_name || "")}</span></span></a>`;
  }).join("") : `<div class="inta-empty">No account contains all of “${esc(clean)}” — try fewer words.</div>`;
  html += rowSection(tokens.length > 1 ? "Accounts matching these words" : "Accounts", userHtml);

  if (tags.length) {
    html += rowSection("Tags containing these words", tags.map((h) => {
      const t = h.hashtag || {};
      return `<a class="inta-row" href="/explore/tags/${encodeURIComponent(t.name || "")}/">`
        + `<span class="inta-ic">#</span>`
        + `<span class="inta-txt"><span class="inta-t1">#${esc(t.name || "")}</span>`
        + `<span class="inta-t2">${Number(t.media_count || 0).toLocaleString()} posts</span></span></a>`;
    }).join(""));
  }
  if (tagUrl && noSpace) {
    html += `<a class="inta-row inta-alt" href="${tagUrl}"><span class="inta-ic">${ic("external", 18)}</span><span class="inta-txt"><span class="inta-t1">#${esc(noSpace)} grid</span><span class="inta-t2">collapsed hashtag version — tap only if you meant the tag</span></span></a>`;
  }
  const placeHtml = placeRows(3);
  if (placeHtml) html += rowSection("Places", placeHtml);
  if (lastData.clips?.length) {
    html += `<div class="inta-sec">Reels for these words</div><div class="inta-reel-grid">` + lastData.clips.slice(0, 6).map((c) =>
      `<a href="/reel/${encodeURIComponent(c.code)}/" class="inta-reel" title="${escAttr(clean)}"><img src="${escAttr(c.thumb)}" loading="lazy" referrerpolicy="no-referrer" draggable="false" alt="" /><span>${ic("play", 10)} ${fmt(c.likes)}</span></a>`
    ).join("") + `</div>`;
  }
  if (keywordUrl) {
    html += `<a class="inta-row" href="${keywordUrl}"><span class="inta-ic">${ic("play", 20)}</span><span class="inta-txt"><span class="inta-t1">See all keyword results</span><span class="inta-t2">instagram keyword search for “${esc(clean)}”</span></span></a>`;
  }
  return html;
}

function rowSection(title, inner) {
  return `<div class="inta-sec">${esc(title)}</div>` + (inner || "");
}

function fmt(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}
})();
