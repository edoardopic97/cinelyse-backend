const axios = require("axios");
const { invokeLLM } = require("./llm");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const KNOWLEDGE_CUTOFF_YEAR = 2025;
const CURRENT_RE = /\b(latest|newest|now playing|in (theaters?|cinemas?)|coming soon|just released|streaming now|currently airing|this (week|month|season))\b/i;

function needsSearch(query) {
  const q = query.toLowerCase();
  // Explicit year after cutoff → ground
  const yearMatch = q.match(/\b(20\d{2})\b/g);
  if (yearMatch && yearMatch.some(y => parseInt(y, 10) > KNOWLEDGE_CUTOFF_YEAR)) return true;
  // Temporal "right now" language + we're past the cutoff → ground
  if (CURRENT_RE.test(q) && new Date().getFullYear() >= KNOWLEDGE_CUTOFF_YEAR) return true;
  return false;
}

async function identifyMoviesFromQuery(userQuery, category) {
  const mediaType = category === "tv" ? "TV shows" : category === "movie" ? "movies" : "movies or TV shows";

  const systemPrompt = `You are a movie and TV expert with encyclopedic knowledge.
Given a user query, return the most accurate matching ${mediaType} as a valid JSON object.

═══ OUTPUT FORMAT ═══
Your entire response must be a single valid JSON object. Nothing else.
No text before it. No text after it. No markdown fences. No explanation. No commentary.
{
  "movies": [
    { "title": "Exact Title", "year": 2019, "type": "movie" },
    { "title": "Exact Title", "year": 2020, "type": "series" }
  ]
}
- Maximum 20 results
- "type" must be exactly "movie" or "series"
- "year" must always be present as an integer
- "title" must match the official title on TMDB/IMDb
- Never return an empty movies array

═══ TYPE FILTER ═══
- Query asks for movies → return only "movie" entries
- Query asks for TV shows / series → return only "series" entries
- Query is ambiguous → return mix of both

═══ COUNTRY / LANGUAGE FILTER ═══
If a country, language, or region is specified, strictly match production origin.
"Thai" = Thailand only. "Korean" = South Korea only. "Bollywood" = Hindi-language Indian cinema only.
Do NOT broaden to nearby countries or the broader region.
If origin is uncertain, exclude the title.

═══ RANKING QUERIES ("best", "top", "ranked") ═══
- Rank by established critical consensus (Metacritic, Rotten Tomatoes, major awards).
- If grounded search data is available, use it as primary source of truth.
- Return results ordered by quality signals (highest first).
- Never fabricate rankings or scores.

═══ FUTURE RELEASES ═══
If grounded data is unavailable for a future year, include only titles with strong signals:
director/franchise reputation, confirmed production, early critical indicators.
Exclude speculative, low-quality, or unverified entries.
Do NOT rank by anticipation unless explicitly asked.

═══ QUALITY ═══
Only include titles with verifiable critical or audience recognition.
Omit titles with unclear reception, weak franchises, or unverified information.`;

  const useSearch = needsSearch(userQuery);
  let content = await invokeLLM(systemPrompt, userQuery, { useSearch });

  let clean = content.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
  }
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) clean = jsonMatch[0];
  clean = clean.replace(/,\s*([}\]])/g, "$1");

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error("[MovieSearch] Failed to parse LLM response as JSON:", clean.substring(0, 200));
    return { movies: [] };
  }
  return { movies: parsed.movies || [] };
}

async function searchTMDB(title, year, type) {
  if (!TMDB_API_KEY) throw new Error("TMDB API key not configured");

  const endpoint = type === "series" ? "search/tv" : type === "movie" ? "search/movie" : "search/multi";
  const params = { api_key: TMDB_API_KEY, query: title, include_adult: false, language: "en-US" };
  if (year) params[type === "series" ? "first_air_date_year" : "year"] = year;

  const res = await axios.get(`${TMDB_BASE}/${endpoint}`, { params });
  const results = res.data.results || [];
  if (!results.length) return null;

  // Pick best match
  const match = results[0];
  const mediaType = match.media_type || (type === "series" ? "tv" : "movie");
  return fetchTMDBDetails(match.id, mediaType);
}

async function fetchTMDBDetails(id, mediaType) {
  const mt = mediaType === "series" ? "tv" : mediaType;
  const res = await axios.get(`${TMDB_BASE}/${mt}/${id}`, {
    params: { api_key: TMDB_API_KEY, append_to_response: "credits,external_ids" },
  });
  const d = res.data;
  const isTV = mt === "tv";

  const directors = isTV
    ? (d.created_by || []).map(c => c.name).join(", ")
    : (d.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name).join(", ");
  const actors = (d.credits?.cast || []).slice(0, 6).map(c => c.name).join(", ");
  const genres = (d.genres || []).map(g => g.name).join(", ");
  const countries = (d.production_countries || d.origin_country || [])
    .map(c => typeof c === "string" ? c : c.name).join(", ");
  const languages = (d.spoken_languages || []).map(l => l.english_name || l.name).join(", ");

  return {
    Title: isTV ? d.name : d.title,
    Year: (isTV ? d.first_air_date : d.release_date || "").slice(0, 4),
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
    Rated: isTV ? (d.adult ? "18+" : "") : (d.adult ? "18+" : ""),
    Backdrop: d.backdrop_path ? `${TMDB_IMG}${d.backdrop_path}` : "",
    Seasons: isTV ? d.number_of_seasons : undefined,
    Episodes: isTV ? d.number_of_episodes : undefined,
    Tagline: d.tagline || undefined,
    Status: d.status || undefined,
  };
}

async function findMoviesFromQuery(userQuery, category = "all") {
  const { movies: identified } = await identifyMoviesFromQuery(userQuery, category);

  const results = await Promise.all(
    identified.map(async ({ title, year, type }) => {
      try {
        const result = await searchTMDB(title, year, type);
        if (result && ((type === "series" && result.Type === "series") || (type === "movie" && result.Type === "movie"))) {
          return result;
        }
      } catch (err) {
        console.error(`[MovieSearch] Error fetching ${title}:`, err.message);
      }
      return null;
    })
  );

  return results.filter(Boolean)
    .sort((a, b) => parseFloat(b.tmdbRating || 0) - parseFloat(a.tmdbRating || 0))
    .slice(0, 20);
}

// TMDB genre ID → name mapping
const GENRE_MAP = {
  28:"Action",12:"Adventure",16:"Animation",35:"Comedy",80:"Crime",99:"Documentary",
  18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",
  9648:"Mystery",10749:"Romance",878:"Science Fiction",10770:"TV Movie",53:"Thriller",
  10752:"War",37:"Western",10759:"Action & Adventure",10762:"Kids",10763:"News",
  10764:"Reality",10765:"Sci-Fi & Fantasy",10766:"Soap",10767:"Talk",10768:"War & Politics",
};

async function directTitleSearch(title, category = "all") {
  if (!TMDB_API_KEY) throw new Error("TMDB API key not configured");

  const endpoint = category === "movie" ? "search/movie" : category === "tv" ? "search/tv" : "search/multi";
  const allMatches = [];

  // Search with en-US, then fallback without language param for original-title matches
  for (const lang of ["en-US", undefined]) {
    if (allMatches.length >= 10) break;
    for (let page = 1; page <= 2; page++) {
      const params = { api_key: TMDB_API_KEY, query: title, page, include_adult: false };
      if (lang) params.language = lang;
      const res = await axios.get(`${TMDB_BASE}/${endpoint}`, { params });
      const results = res.data.results || [];
      if (!results.length) break;
      allMatches.push(...results);
      if (page >= res.data.total_pages) break;
    }
  }

  if (!allMatches.length) return [];

  const queryLower = title.toLowerCase().trim();
  const seen = new Set();

  return allMatches
    .filter(m => {
      // Dedupe
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      // Only movie or tv results from multi search
      if (endpoint === "search/multi" && m.media_type !== "movie" && m.media_type !== "tv") return false;
      // Must have a title
      const name = m.title || m.name;
      if (!name) return false;
      // Filter out stub entries with no poster and no votes
      if (!m.poster_path && (!m.vote_count || m.vote_count === 0)) return false;
      return true;
    })
    .map(m => {
      const isTV = m.media_type === "tv" || (!m.title && m.name) || category === "tv";
      const name = isTV ? m.name : m.title;
      const nameLower = (name || "").toLowerCase();
      // Relevance score: exact match > starts with > contains, then by popularity
      let relevance = 0;
      if (nameLower === queryLower) relevance = 3;
      else if (nameLower.startsWith(queryLower)) relevance = 2;
      else if (nameLower.includes(queryLower)) relevance = 1;
      return {
        Title: name,
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
        _relevance: relevance,
        _popularity: m.popularity || 0,
      };
    })
    .sort((a, b) => {
      // Sort by relevance tier first, then popularity within each tier
      if (b._relevance !== a._relevance) return b._relevance - a._relevance;
      return b._popularity - a._popularity;
    })
    .slice(0, 30)
    .map(({ _relevance, _popularity, ...rest }) => rest);
}

module.exports = { findMoviesFromQuery, directTitleSearch };
