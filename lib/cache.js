const crypto = require("crypto");
const { db } = require("./firebase");

const COLLECTION = "searchCache";
const TTL_TRENDING = 7 * 24 * 60 * 60 * 1000;   // 7 days
const TTL_EVERGREEN = 30 * 24 * 60 * 60 * 1000;  // 30 days

// Matches queries whose results change over time (rankings, current releases, future years)
const TRENDING_RE = /\b(best|top|highest[- ]rated|most popular|trending|ranked|box[- ]office|award|oscar|emmy|winner|nominated|blockbuster|what'?s new|what'?s on|now playing|in theaters?|in cinemas?|coming soon|just released|streaming now|currently|this (week|month|season|year)|latest|recent|new releases?)\b/i;

function cacheKey(query, category) {
  const normalized = `${query.trim().toLowerCase()}:${category}`;
  return crypto.createHash("md5").update(normalized).digest("hex");
}

function isTrending(query) {
  return TRENDING_RE.test(query);
}

async function getCachedResults(query, category) {
  try {
    const doc = await db.collection(COLLECTION).doc(cacheKey(query, category)).get();
    if (!doc.exists) return null;
    const data = doc.data();
    const age = Date.now() - (data.createdAt || 0);
    const ttl = data.trending ? TTL_TRENDING : TTL_EVERGREEN;
    if (age > ttl) return null;
    return JSON.parse(data.response);
  } catch (err) {
    console.error("[Cache] Read error:", err.message);
    return null;
  }
}

async function setCachedResults(query, category, results, uid) {
  try {
    await db.collection(COLLECTION).doc(cacheKey(query, category)).set({
      query: query.trim().toLowerCase(),
      category,
      uid: uid || null,
      response: JSON.stringify(results),
      trending: isTrending(query),
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("[Cache] Write error:", err.message);
  }
}

module.exports = { getCachedResults, setCachedResults };
