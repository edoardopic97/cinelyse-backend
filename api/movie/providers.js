const axios = require("axios");
const { verifyAuth } = require("../../lib/auth");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/original";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id, type, region } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });

  const mt = type === "tv" ? "tv" : "movie";
  const cc = (region || "US").toUpperCase();

  try {
    const r = await axios.get(`${TMDB_BASE}/${mt}/${id}/watch/providers`, {
      params: { api_key: TMDB_API_KEY },
    });

    const country = r.data.results?.[cc] || {};
    const seen = new Set();
    const providers = [];

    for (const bucket of ["flatrate", "ads", "free", "rent", "buy"]) {
      for (const p of country[bucket] || []) {
        if (seen.has(p.provider_id)) continue;
        seen.add(p.provider_id);
        providers.push({
          id: p.provider_id,
          name: p.provider_name,
          logo: p.logo_path ? `${TMDB_IMG}${p.logo_path}` : "",
          type: bucket,
        });
      }
    }

    const link = country.link || "";

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=172800");
    return res.status(200).json({ providers, link });
  } catch {
    return res.status(500).json({ error: "Failed to fetch providers" });
  }
};
