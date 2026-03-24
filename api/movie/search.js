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

  const { s, type } = req.query;
  if (!s) return res.status(400).json({ error: "Missing search query" });

  try {
    const endpoint = type === "tv" ? "search/tv" : type === "movie" ? "search/movie" : "search/multi";
    const r = await axios.get(`${TMDB_BASE}/${endpoint}`, {
      params: { api_key: TMDB_API_KEY, query: s, include_adult: false },
    });
    res.status(200).json(r.data);
  } catch (err) {
    res.status(500).json({ error: "TMDB request failed" });
  }
};
