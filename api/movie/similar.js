const axios = require("axios");
const { verifyAuth } = require("../../lib/auth");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const GENRE_MAP = {
  28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",
  18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",
  9648:"Mystery",10749:"Romance",878:"Science Fiction",10770:"TV Movie",53:"Thriller",
  10752:"War",37:"Western",10759:"Action & Adventure",10762:"Kids",10763:"News",
  10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",
};

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
    const r = await axios.get(`${TMDB_BASE}/${mt}/${id}/recommendations`, {
      params: { api_key: TMDB_API_KEY },
    });

    const movies = (r.data.results || []).slice(0, 12).map(m => {
      const isTV = mt === "tv" || m.media_type === "tv";
      return {
        Title: isTV ? m.name : m.title,
        Year: ((isTV ? m.first_air_date : m.release_date) || "").slice(0, 4),
        Poster: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : "",
        Genre: (m.genre_ids || []).map(gid => GENRE_MAP[gid] || "").filter(Boolean).join(", "),
        Plot: m.overview || "",
        tmdbRating: m.vote_average ? m.vote_average.toFixed(1) : "",
        voteCount: m.vote_count || 0,
        Type: isTV ? "series" : "movie",
        tmdbID: m.id,
        Backdrop: m.backdrop_path ? `${TMDB_IMG}${m.backdrop_path}` : "",
        _lightweight: true,
      };
    });

    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=172800");
    return res.status(200).json({ movies });
  } catch {
    return res.status(500).json({ error: "Failed to fetch recommendations" });
  }
};
