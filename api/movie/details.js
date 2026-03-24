const axios = require("axios");
const { verifyAuth } = require("../../lib/auth");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

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
    const mt = type === "tv" ? "tv" : "movie";
    const r = await axios.get(`${TMDB_BASE}/${mt}/${id}`, {
      params: { api_key: TMDB_API_KEY, append_to_response: "credits,external_ids" },
    });
    const d = r.data;
    const isTV = mt === "tv";

    const directors = isTV
      ? (d.created_by || []).map(c => c.name).join(", ")
      : (d.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name).join(", ");
    const actors = (d.credits?.cast || []).slice(0, 6).map(c => c.name).join(", ");
    const genres = (d.genres || []).map(g => g.name).join(", ");
    const countries = (d.production_countries || d.origin_country || [])
      .map(c => typeof c === "string" ? c : c.name).join(", ");
    const languages = (d.spoken_languages || []).map(l => l.english_name || l.name).join(", ");

    res.status(200).json({
      Title: isTV ? d.name : d.title,
      Year: ((isTV ? d.first_air_date : d.release_date) || "").slice(0, 4),
      Poster: d.poster_path ? `${TMDB_IMG}${d.poster_path}` : "",
      Genre: genres,
      Plot: d.overview || "",
      tmdbRating: d.vote_average ? d.vote_average.toFixed(1) : "",
      voteCount: d.vote_count || 0,
      Runtime: isTV
        ? (d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min` : d.number_of_seasons ? `${d.number_of_seasons} Season${d.number_of_seasons > 1 ? "s" : ""}` : "")
        : (d.runtime ? `${d.runtime} min` : ""),
      Country: countries,
      Type: isTV ? "series" : "movie",
      Director: directors || undefined,
      Actors: actors || undefined,
      Language: languages,
      tmdbID: d.id,
      imdbID: d.external_ids?.imdb_id || d.imdb_id || undefined,
      Rated: d.adult ? "18+" : "",
      Backdrop: d.backdrop_path ? `${TMDB_IMG}${d.backdrop_path}` : "",
      Seasons: isTV ? d.number_of_seasons : undefined,
      Episodes: isTV ? d.number_of_episodes : undefined,
      Tagline: d.tagline || undefined,
      Status: d.status || undefined,
    });
  } catch (err) {
    res.status(500).json({ error: "TMDB request failed" });
  }
};
