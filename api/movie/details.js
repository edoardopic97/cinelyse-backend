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
  if (!id) return res.status(400).json({ error: "Missing ID" });

  try {
    const mediaType = type === "tv" ? "tv" : "movie";
    const r = await axios.get(`${TMDB_BASE}/${mediaType}/${id}`, {
      params: { api_key: TMDB_API_KEY, append_to_response: "credits,external_ids" },
    });
    res.status(200).json(r.data);
  } catch (err) {
    res.status(500).json({ error: "TMDB request failed" });
  }
};
