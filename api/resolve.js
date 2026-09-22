/* Vercel serverless: GET /api/resolve?url=<instagram-link>
   Public posts only (no login session server-side). Extracts the ORIGINAL
   file URLs from Instagram's own surfaces — same technique as the
   reference downloaders (fastdl/indown/saveclip):
     1. Reel/post page HTML (/reel/<code>/) — server-rendered video data
     2. /p/<code>/embed/ + /embed/captioned/ + /reel/<code>/embed/ HTML
     3. ?__a=1&__d=dis JSON (public data when available)
     4. oEmbed → title / thumbnail / author (fallback + image posts)
   First source that yields a video track wins; images are last resort.
   Returns: { ok, type: video|image|carousel, title, author, thumbnail, medias: [{url, quality, width}] }
   Private/login-gated posts → { ok:false, error:"private-or-login" } honestly. */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function shortcode(url) {
  try {
    const u = new URL(String(url));
    const h = u.hostname.toLowerCase();
    if (h !== "instagram.com" && !h.endsWith(".instagram.com")) return "";
    const m = u.pathname.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    return m ? m[2] : "";
  } catch {
    return "";
  }
}
function unesc(s) {
  return String(s || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\&/g, "&")
    .replace(/\\/g, "")
    .replace(/&amp;/g, "&");
}
function cleanUrl(s) {
  const u = unesc(s);
  const m = u.match(/https?:\/\/[^"'\s<>]+/);
  const out = (m ? m[0] : u).trim().replace(/[.,;!?]+$/, "");
  return /^https?:\/\//.test(out) ? out : "";
}
function qualityFor(w, type) {
  if (type !== "video") return "JPG";
  const n = Number(w) || 0;
  if (n >= 1080) return "Full HD";
  if (n >= 720) return "HD";
  return "SD";
}
function normPayload(t) {
  return String(t || "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&");
}
async function getText(url, ms, accept) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept || "text/html" },
      signal: AbortSignal.timeout(ms || 12000),
    });
    if (!r.ok) return "";
    return await r.text();
  } catch {
    return "";
  }
}
// Pull every progressive mp4 out of a blob of HTML/JSON text.
// Wide windows + both key orders + loose quoting: Instagram re-escapes
// this payload constantly, so strict patterns silently miss the video
// (the old bug: reel resolved as JPG cover only).
function extractVideos(text, videos) {
  const src = normPayload(text);
  if (!src) return;
  // video_versions blocks (wide window, both key orders).
  for (const m of src.matchAll(/"video_versions"\s*:\s*\[([\s\S]{0,40000}?)\]/g)) {
    const block = m[1];
    for (const v of block.matchAll(/"width"\s*:\s*(\d+)[^}]{0,600}?"url"\s*:\s*"([^"]+)"/g)) {
      const u = cleanUrl(v[2]);
      if (/\.mp4/i.test(u) && u) {
        const w = Number(v[1]) || 0;
        if (!videos.has(u) || videos.get(u) < w) videos.set(u, w);
      }
    }
    for (const v of block.matchAll(/"url"\s*:\s*"([^"]+?\.mp4[^"]*)"[^}]{0,600}?"width"\s*:\s*(\d+)/gi)) {
      const u = cleanUrl(v[1]);
      if (u) {
        const w = Number(v[2]) || 0;
        if (!videos.has(u) || videos.get(u) < w) videos.set(u, w);
      }
    }
    for (const v of block.matchAll(/"url"\s*:\s*"([^"]+?\.mp4[^"]*)"/gi)) {
      const u = cleanUrl(v[1]);
      if (u && !videos.has(u)) videos.set(u, 0);
    }
  }
  // Loose video_url (any escaping/quote style).
  for (const m of src.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
    const u = cleanUrl(m[1]);
    if (/\.mp4/i.test(u) && u && !videos.has(u)) videos.set(u, 720);
  }
  for (const m of src.matchAll(/video_url\\*"\s*:\s*\\*"([^"\\]+)/g)) {
    const u = cleanUrl(m[1]);
    if (/\.mp4/i.test(u) && u && !videos.has(u)) videos.set(u, 720);
  }
  // Last resort: any mp4 on Instagram's own CDNs (never page JS — hosts only).
  for (const m of src.matchAll(/https?:\/\/(?:[^"'\s<>]*?\.)?(?:cdninstagram\.com|fbcdn\.net)[^"'\s<>]*?\.mp4[^"'\s<>]*/gi)) {
    const u = cleanUrl(m[0]);
    if (u && !videos.has(u)) videos.set(u, 0);
  }
}
function extractImages(text, images) {
  const src = normPayload(text);
  if (!src) return;
  for (const m of src.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
    const u = cleanUrl(m[1]);
    if (u && /cdninstagram|fbcdn/i.test(u) && !images.has(u)) images.set(u, 1080);
  }
}

module.exports = async (req, res) => {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    const target = String((req.query && req.query.url) || "");
    const code = shortcode(target);
    if (!code) {
      return res.status(400).json({ ok: false, error: "bad-url — pass a /p/, /reel/ or /reels/ link" });
    }
    const enc = encodeURIComponent(code);
    const videos = new Map(); // url -> width
    const images = new Map();

    // Source 1: reel/post page HTML (server-rendered, richest for videos).
    const pageHtml = await getText(`https://www.instagram.com/reel/${enc}/`, 12000);
    extractVideos(pageHtml, videos);
    extractImages(pageHtml, images);

    // Source 2: embed variants (no auth wall).
    if (!videos.size) {
      for (const u of [
        `https://www.instagram.com/p/${enc}/embed/captioned/`,
        `https://www.instagram.com/p/${enc}/embed/`,
        `https://www.instagram.com/reel/${enc}/embed/`,
      ]) {
        const html = await getText(u, 10000);
        if (!html) continue;
        extractVideos(html, videos);
        extractImages(html, images);
        if (videos.size) break;
      }
    }

    // Source 3: ?__a=1 JSON (public data when Instagram serves it).
    if (!videos.size) {
      const j = await getText(`https://www.instagram.com/p/${enc}/?__a=1&__d=dis`, 10000, "application/json");
      if (j) {
        extractVideos(j, videos);
        extractImages(j, images);
      }
    }

    if (!videos.size && !images.size) {
      if (!pageHtml || pageHtml.length < 2000) {
        return res.status(404).json({ ok: false, error: "not-found-or-private" });
      }
      if (/login|not-logged-in/i.test(pageHtml.slice(0, 3000)) && pageHtml.length < 12000) {
        return res.status(403).json({ ok: false, error: "private-or-login" });
      }
      return res.status(404).json({ ok: false, error: "no-media — post may be private or removed" });
    }

    let title = "", author = "", thumb = "";
    try {
      const r = await fetch(`https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(target)}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        title = String(j.title || "").slice(0, 140);
        author = String(j.author_name || "");
        thumb = cleanUrl(j.thumbnail_url || "");
      }
    } catch {}

    const isVideo = videos.size > 0;
    const medias = [];
    if (isVideo) {
      for (const [u, w] of [...videos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
        medias.push({ url: u, quality: qualityFor(w, "video"), width: w });
      }
    } else {
      const pics = [...images.keys()].slice(0, 10);
      if (thumb && !pics.includes(thumb)) pics.unshift(thumb);
      for (const u of pics.slice(0, 10)) medias.push({ url: u, quality: "JPG", width: 1080 });
    }
    if (!medias.length) {
      return res.status(404).json({ ok: false, error: "no-media — post may be private or removed" });
    }
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      ok: true,
      type: isVideo ? "video" : images.size > 1 ? "carousel" : "image",
      title,
      author,
      thumbnail: thumb || medias[0].url,
      medias,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server-error" });
  }
};
