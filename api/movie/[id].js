const axios = require("axios");

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

module.exports = async (req, res) => {
  const { id } = req.query;
  if (!id) {
    res.status(400).send("Invalid movie ID");
    return;
  }

  let movie = null;
  // id can be tmdb numeric id or imdb tt id
  try {
    let tmdbId = id;
    let mediaType = "movie";

    if (id.startsWith("tt")) {
      // Look up by IMDB ID
      const find = await axios.get(`${TMDB_BASE}/find/${id}`, {
        params: { api_key: TMDB_API_KEY, external_source: "imdb_id" },
      });
      const movieResults = find.data.movie_results || [];
      const tvResults = find.data.tv_results || [];
      if (movieResults.length) { tmdbId = movieResults[0].id; mediaType = "movie"; }
      else if (tvResults.length) { tmdbId = tvResults[0].id; mediaType = "tv"; }
      else { res.status(404).send("Movie not found"); return; }
    }

    const r = await axios.get(`${TMDB_BASE}/${mediaType}/${tmdbId}`, {
      params: { api_key: TMDB_API_KEY },
    });
    movie = r.data;
  } catch {}

  const title = movie?.title || movie?.name || "Movie";
  const year = (movie?.release_date || movie?.first_air_date || "").slice(0, 4);
  const poster = movie?.poster_path ? `${TMDB_IMG}${movie.poster_path}` : "";
  const rating = movie?.vote_average ? movie.vote_average.toFixed(1) : "";
  const genre = (movie?.genres || []).map(g => g.name).join(", ");
  const plot = movie?.overview || "";
  const runtime = movie?.runtime ? `${movie.runtime} min` : "";
  const deepLink = `cinelyse://movie/${id}`;
  const ogDesc = plot || `${genre}${year ? ` • ${year}` : ""}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}${year ? ` (${year})` : ""} — CINELYSE</title>
  <meta property="og:title" content="${title}${year ? ` (${year})` : ""}"/>
  <meta property="og:description" content="${ogDesc}"/>
  ${poster ? `<meta property="og:image" content="${poster}"/>` : ""}
  <meta property="og:type" content="website"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d0204;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{max-width:420px;width:90%;text-align:center;padding:32px 24px}
    .poster{width:200px;height:300px;object-fit:cover;border-radius:12px;margin:0 auto 24px;display:block;box-shadow:0 8px 40px rgba(200,30,30,0.3)}
    .no-poster{width:200px;height:300px;border-radius:12px;margin:0 auto 24px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:48px;color:rgba(255,255,255,0.15)}
    h1{font-size:24px;font-weight:800;margin-bottom:6px}
    .meta{color:rgba(255,255,255,0.5);font-size:14px;margin-bottom:16px}
    .rating{display:inline-flex;align-items:center;gap:4px;background:rgba(245,197,24,0.12);border:1px solid rgba(245,197,24,0.3);border-radius:20px;padding:4px 12px;font-size:14px;font-weight:700;color:#f5c518;margin-bottom:16px}
    .plot{color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:24px}
    .open-btn{display:inline-block;background:linear-gradient(135deg,#c0392b,#e74c3c);color:#fff;font-size:16px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;margin-bottom:12px;box-shadow:0 4px 20px rgba(200,40,40,0.4)}
    .store{color:rgba(255,255,255,0.35);font-size:13px;margin-top:8px}
    .logo{font-size:13px;color:rgba(255,255,255,0.25);margin-top:32px;letter-spacing:1px}
    .tmdb{color:#01b4e4;text-decoration:none;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:4px;margin-top:12px}
  </style>
</head>
<body>
  <div class="card">
    ${poster ? `<img class="poster" src="${poster}" alt="${title}"/>` : `<div class="no-poster">🎬</div>`}
    <h1>${title}</h1>
    <div class="meta">${[year, genre, runtime].filter(Boolean).join(" · ")}</div>
    ${rating ? `<div class="rating">⭐ ${rating} TMDB</div>` : ""}
    ${plot ? `<p class="plot">${plot}</p>` : ""}
    <a class="open-btn" href="${deepLink}" id="openApp">Open in CINELYSE</a>
    <p class="store">Coming soon to the Play Store & App Store</p>
    ${movie?.imdb_id ? `<a class="tmdb" href="https://www.themoviedb.org/${movie.title ? 'movie' : 'tv'}/${movie.id}" target="_blank">View on TMDB →</a>` : ""}
    <div class="logo">CINELYSE</div>
  </div>
  <script>
    setTimeout(function(){ window.location.href="${deepLink}"; }, 100);
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
};
