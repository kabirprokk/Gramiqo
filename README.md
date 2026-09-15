# Inta-Enhancer

Mobile Instagram features for PC web. A Manifest V3 Chrome extension (works in Chrome, Edge, Brave) that brings the phone experience to `instagram.com`: **Search with Meta AI**, downloads, **320kbps MP3 audio**, story tools, reels toolkit, HD pics, bio-links + Notes editors, settings hub, and a deep mobile-illusion stack.

**Version:** 1.2.1 · **OLIN:** 1.2.b
*(OLIN names climb `1.1.a → … → 1.1.k → 1.2.a …` — the display name for each production stage.)*

🌐 **Website:** open [`website/index.html`](website/index.html) — features, install guide, FAQ, [bug report page](website/bug.html).
🐞 **Found a bug?** [Report it here](https://github.com/kabirprokk/insta-enhancer/issues/new) or via the website's bug page (opens a pre-filled issue).

## Install (60 seconds, free)

1. **Download:** [direct ZIP](https://github.com/kabirprokk/insta-enhancer/archive/refs/heads/main.zip) (or `git clone https://github.com/kabirprokk/insta-enhancer.git`), unzip.
2. Open `chrome://extensions` → enable **Developer mode** (top-right).
3. **Load unpacked** → select the repo folder (the one containing `manifest.json`).
4. Open `instagram.com`, log in, reload once. Click the toolbar icon to toggle features.

Updating: pull/ZIP again → `chrome://extensions` → ⟳ Reload → `Ctrl+Shift+R` on Instagram tabs.

## Features

| Area | What |
|---|---|
| Search with Meta AI | Keyword-first (default) + For-you answer card + follow-up box, pins, recents, places, Keyword/Accounts/Reels/Audio/Tags tabs, keyboard nav (`/`, `↓`) |
| Downloads | Per-post/reel buttons, story saver, bulk grid saver (up to 12), HD avatars |
| MP3 audio | Music-note button under every video → 320kbps MP3, captured on-device, nothing leaves the browser |
| Reels toolkit | Speed 1×–2×, loop, mute, auto-next; auto-unmute; click-to-open reel view; explore reels open full-screen |
| Profiles | HD pic modal, copy link/avatar/stats, growth tracker, inline edit counters, desktop bio-links editor |
| Notes | Read / post (60 chars, audience picker) / delete your DM note from PC |
| Create | Quick Create opens IG's own composer (posts + reels); Story Studio composes 9:16 files for phone upload |
| Settings hub | Filterable hub: private-account switch, data saver, screen-time + daily limit, deep links, honest Soon badges |
| Mobile illusion | iPhone UA header + Sec-CH client hints + page-world `navigator` spoof (toggle: Mobile feel) |
| Command palette | `Ctrl+K` → every action; shortcuts `N` new post, `D` download, `C` caption, `F` fullscreen, `P` PiP |

"Soon" badges mark features that need the native app engine (stickers, AR, vanish mode…) — the extension never fakes them.

## Permissions (why each)

| Permission | Why |
|---|---|
| `storage` | Toggle states (sync) + recents/pins/stats (local, on-device only) |
| `downloads` | Saving media/audio files |
| `declarativeNetRequest (+WithHostAccess)` | iPhone UA + mobile client-hints headers on instagram.com |
| `tabs` / `activeTab` | Popup buttons (open Instagram, reload on toggle, message the IG tab) |
| `scripting` | Page-world mobile spoof, registered only while Mobile feel is ON |
| Hosts `instagram.com`, `cdninstagram.com`, `fbcdn.net` | Content scripts + media fetching |

No backend, no analytics, no tracking. Your login stays in Instagram's own cookies.

## Project layout

```
manifest.json      MV3 manifest (1.2.1 / OLIN 1.2.b)
icons.js           inline-SVG icon set (zero network requests, CSP-safe)
vendor/lame.min.js MP3 encoder (vendored, runs fully offline)
background.js      downloads queue + mobile-illusion network rules + spoof registration
spoof.js           page-world navigator/iPhone spoof (document_start, toggle-gated)
content.js         posts, profiles, links editor, MP3 capture, composer entry
search.js          Meta-AI search panel, tabs, pins, places
power.js           story saver, reels toolkit, palette, hub, notes, stats, studio
popup.*            toolbar popup (all toggles)
website/           landing site: index.html, bug.html, styles.css, script.js
```

## Safety notes

- Everything uses the same endpoints Instagram's own website uses, at human speed, with caching and caps. No mass actions, no spam.
- Some reels are DRM/streaming-protected and can't be saved — the extension says so instead of failing silently.
- Teen-safety and server-side filters (e.g. hidden search results) are never bypassed.

## License

MIT — see [LICENSE](LICENSE).
