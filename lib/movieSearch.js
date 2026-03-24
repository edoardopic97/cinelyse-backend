const axios = require("axios");
const { invokeLLM } = require("./llm");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

const KNOWLEDGE_CUTOFF_YEAR = parseInt(process.env.KNOWLEDGE_CUTOFF_YEAR || "2024", 10);

function needsSearch(query) {
  const yearMatch = query.match(/\b(19|20)\d{2}\b/g);
  if (yearMatch && yearMatch.some(y => parseInt(y, 10) > KNOWLEDGE_CUTOFF_YEAR)) return true;
  return /\b(latest|recent|new|current|this year|now playing)\b/i.test(query);
}

async function identifyMoviesFromQuery(userQuery, category) {
  const mediaType = category === "tv" ? "TV shows" : category === "movie" ? "movies" : "movies or TV shows";

  const systemPrompt = `You are a movie and TV expert with encyclopedic knowledge. Given a user's query, return the most accurate matching ${mediaType}.

**IMPORTANT:** You MUST return a valid JSON object. Do NOT include any explanation, text, or markdown. If you return anything other than JSON, the response is invalid.

Return JSON with an array of results (up to 20):
{
  "movies": [
    {"title": "Movie Title", "year": 2019, "type": "movie"},
    {"title": "TV Show Title", "year": 2020, "type": "series"}
  ]
}

CRITICAL RULES:
- ALWAYS return results. Never return an empty array.
- Use exact official titles as they appear on TMDB/IMDb.
- ALWAYS include the release year.
- ALWAYS specify "type" as either "movie" or "series".

GROUNDING RULES:
- If external search/grounding data is available, you MUST rely on it as the primary source of truth.
- Prefer real, current data such as ratings, critic scores, or reputable rankings.
- Do NOT invent rankings or approximate if grounded data provides clear answers.

RANKING / "TOP" QUERIES:
- If the query involves "top", "best", or "ranked":
  → Use grounded data when available.
  → Return results ordered by actual quality signals (highest first).

FUTURE YEAR HANDLING:
- If the query refers to a future year AND no grounded ranking data exists:
  → Return only high-quality, credible films expected for that year.
  → Base selection on director reputation, franchise quality, and early critical signals.
  → DO NOT treat this as "most anticipated" unless explicitly asked.
  → EXCLUDE likely low-quality, poorly reviewed, or weak-franchise films.

QUALITY FILTER:
- Only include films with strong evidence of quality, critical praise, or reputable source support.
- Omit films with unclear reception, weak franchises, or unverified information.

TYPE FILTER:
- If the user asks for movies → ONLY return "movie"
- If the user asks for TV shows → ONLY return "series"

FINAL OUTPUT RULE:
- Return ONLY the JSON object. NO text, NO explanations, NO markdown, NO extra comments.`;

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
    if (useSearch) {
      content = await invokeLLM(systemPrompt, userQuery, { useSearch: false });
      clean = content.trim();
      if (clean.startsWith("```")) {
        clean = clean.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
      }
      const retry = clean.match(/\{[\s\S]*\}/);
      if (retry) clean = retry[0];
      clean = clean.replace(/,\s*([}\]])/g, "$1");
      parsed = JSON.parse(clean);
    } else {
      throw new Error("Failed to parse LLM response as JSON");
    }
  }
  return { movies: parsed.movies || [] };
}

async function searchTMDB(title, year, type) {
  if (!TMDB_API_KEY) throw new Error("TMDB API key not configured");

  const endpoint = type === "series" ? "search/tv" : type === "movie" ? "search/movie" : "search/multi";
  const params = { api_key: TMDB_API_KEY, query: title, include_adult: false };
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

async function directTitleSearch(title, category = "all") {
  if (!TMDB_API_KEY) throw new Error("TMDB API key not configured");

  const endpoint = category === "movie" ? "search/movie" : category === "tv" ? "search/tv" : "search/multi";
  const allMatches = [];

  for (let page = 1; page <= 3; page++) {
    const res = await axios.get(`${TMDB_BASE}/${endpoint}`, {
      params: { api_key: TMDB_API_KEY, query: title, page, include_adult: false },
    });
    const results = res.data.results || [];
    if (!results.length) break;
    allMatches.push(...results);
    if (page >= res.data.total_pages) break;
  }

  if (!allMatches.length) return [];

  // Deduplicate
  const seen = new Set();
  const unique = allMatches.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, 40);

  const results = await Promise.all(
    unique.map(async (m) => {
      try {
        const mediaType = m.media_type || (category === "tv" ? "tv" : category === "movie" ? "movie" : (m.title ? "movie" : "tv"));
        return await fetchTMDBDetails(m.id, mediaType);
      } catch { return null; }
    })
  );

  return results.filter(Boolean);
}

module.exports = { findMoviesFromQuery, directTitleSearch };
