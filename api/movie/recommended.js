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

function mapResult(m, isTV) {
  return {
    Title: isTV ? m.name : m.title,
    Year: ((isTV ? m.first_air_date : m.release_date) || "").slice(0, 4),
    Poster: m.poster_path ? `${TMDB_IMG}${m.poster_path}` : "",
    Genre: (m.genre_ids || []).map(id => GENRE_MAP[id] || "").filter(Boolean).join(", "),
    Plot: m.overview || "",
    tmdbRating: m.vote_average ? m.vote_average.toFixed(1) : "",
    voteCount: m.vote_count || 0,
    Type: isTV ? "series" : "movie",
    tmdbID: m.id,
    Backdrop: m.backdrop_path ? `${TMDB_IMG}${m.backdrop_path}` : "",
    _lightweight: true,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { favorites, excludeIds } = req.body || {};
  if (!Array.isArray(favorites) || !favorites.length) {
    return res.status(200).json({ movies: [], tv: [] });
  }
  const excluded = new Set([...(excludeIds || []), ...favorites.map(f => f.tmdbID)]);

  try {
    // Fetch recommendations for up to 10 favorites (to stay fast)
    const sample = favorites.slice(0, 10);
    const results = await Promise.all(
      sample.map(async ({ tmdbID, type }) => {
        const mt = type === "series" ? "tv" : "movie";
        try {
          const r = await axios.get(`${TMDB_BASE}/${mt}/${tmdbID}/recommendations`, {
            params: { api_key: TMDB_API_KEY },
          });
          return (r.data.results || []).map(m => {
            const isTV = mt === "tv" || m.media_type === "tv";
            return { ...m, _isTV: isTV };
          });
        } catch { return []; }
      })
    );

    const all = results.flat();
    const seenMovies = new Map();
    const seenTV = new Map();

    for (const m of all) {
      if (excluded.has(m.id)) continue;
      if (!m.poster_path || !m.vote_average) continue;
      const target = m._isTV ? seenTV : seenMovies;
      if (!target.has(m.id) || m.vote_average > target.get(m.id).vote_average) {
        target.set(m.id, m);
      }
    }

    const movies = [...seenMovies.values()]
      .sort((a, b) => b.vote_average - a.vote_average)
      .slice(0, 20)
      .map(m => mapResult(m, false));

    const tv = [...seenTV.values()]
      .sort((a, b) => b.vote_average - a.vote_average)
      .slice(0, 20)
      .map(m => mapResult(m, true));

    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return res.status(200).json({ movies, tv });
  } catch {
    return res.status(500).json({ error: "Failed to fetch recommendations" });
  }
};
