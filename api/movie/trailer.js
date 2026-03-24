const axios = require("axios");
const { verifyAuth } = require("../../lib/auth");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { id, type } = req.query;
  if (!id) return res.status(400).json({ error: "Missing id" });

  const mt = type === "tv" ? "tv" : "movie";

  try {
    const r = await axios.get(`${TMDB_BASE}/${mt}/${id}/videos`, {
      params: { api_key: TMDB_API_KEY },
    });

    const vids = (r.data.results || []).filter(v => v.site === "YouTube");
    const trailer =
      vids.find(v => v.type === "Trailer" && v.official) ||
      vids.find(v => v.type === "Trailer") ||
      vids.find(v => v.type === "Teaser") ||
      vids[0];

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=172800");
    return res.status(200).json({ key: trailer?.key || null });
  } catch {
    return res.status(500).json({ error: "Failed to fetch trailer" });
  }
};
