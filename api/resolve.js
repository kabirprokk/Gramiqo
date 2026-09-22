/* Vercel serverless: GET /api/resolve?url=<instagram-link>
   Public posts only (no login session server-side). Extracts the ORIGINAL
   file URLs from Instagram's own embed surfaces — same technique as the
   reference downloaders (fastdl/indown/saveclip):
     1. /p/<code>/embed/captioned/ HTML → video_url / video_versions / display_url
     2. oEmbed → title / thumbnail / author (fallback + image posts)
   Returns: { ok, type: video|image|carousel, title, author, thumbnail, medias: [{url, quality, width, thumb}] }
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
  const out = (m ? m[0] : u).trim();
  return /^https?:\/\//.test(out) ? out : "";
}
function qualityFor(w, type) {
  if (type !== "video") return "JPG";
  const n = Number(w) || 0;
  if (n >= 1080) return "Full HD";
  if (n >= 720) return "HD";
  return "SD";
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

    // 1. Embed HTML (no auth wall, holds video_url + display media).
    let html = "";
    try {
      const r = await fetch(`https://www.instagram.com/p/${encodeURIComponent(code)}/embed/captioned/`, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) html = await r.text();
    } catch {}
    if (!html || html.length < 2000) {
      return res.status(404).json({ ok: false, error: "not-found-or-private" });
    }
    if (/login|not-logged-in/i.test(html.slice(0, 2000)) && html.length < 8000) {
      return res.status(403).json({ ok: false, error: "private-or-login" });
    }

    const videos = new Map(); // url -> width
    for (const m of html.matchAll(/"video_versions"\s*:\s*\[([\s\S]{0,6000}?)\]/g)) {
      for (const v of m[1].matchAll(/\{\s*"width"\s*:\s*(\d+)[^}]*?"url"\s*:\s*"([^"]+)"/g)) {
        const u = cleanUrl(v[2]);
        if (/\.mp4/i.test(u) && u) {
          const w = Number(v[1]) || 0;
          if (!videos.has(u) || videos.get(u) < w) videos.set(u, w);
        }
      }
      for (const v of m[1].matchAll(/"url"\s*:\s*"([^"]+)"/g)) {
        const u = cleanUrl(v[1]);
        if (/\.mp4/i.test(u) && u && !videos.has(u)) videos.set(u, 0);
      }
    }
    for (const m of html.matchAll(/"video_url"\s*:\s*"([^"]+)"/g)) {
      const u = cleanUrl(m[1]);
      if (u && !videos.has(u)) videos.set(u, 720);
    }

    const images = new Map();
    for (const m of html.matchAll(/"display_url"\s*:\s*"([^"]+)"/g)) {
      const u = cleanUrl(m[1]);
      if (u && /cdninstagram|fbcdn/i.test(u) && !images.has(u)) images.set(u, 1080);
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
