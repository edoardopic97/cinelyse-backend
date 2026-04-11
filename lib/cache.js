const crypto = require("crypto");
const { db } = require("./firebase");

const COLLECTION = "searchCache";
const TTL_TRENDING = 7 * 24 * 60 * 60 * 1000;   // 7 days
const TTL_EVERGREEN = 30 * 24 * 60 * 60 * 1000;  // 30 days

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','could','should','may','might','can','shall',
  'i','me','my','we','our','you','your','he','she','it','they','them','their',
  'this','that','these','those','what','which','who','whom',
  'some','any','all','each','every','no','not','very','really','just','also',
  'about','like','find','show','give','get','want','need','looking','search',
  'good','great','nice','amazing','awesome','fantastic','excellent','wonderful','incredible',
  'bad','worst','terrible','horrible','awful',
  'please','thanks','thank','hey','hi','hello',
  'movie','movies','film','films','show','shows','series','tv',
  'recommend','recommendations','suggest','suggestions','tell',
]);

function normalizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w))
    .sort()
    .join(' ');
}

function cacheKey(query, category) {
  const normalized = `${normalizeQuery(query)}:${category}`;
  return crypto.createHash("md5").update(normalized).digest("hex");
}

const TRENDING_RE = /\b(best|top|highest[- ]rated|most popular|trending|ranked|box[- ]office|award|oscar|emmy|winner|nominated|blockbuster|what'?s new|what'?s on|now playing|in theaters?|in cinemas?|coming soon|just released|streaming now|currently|this (week|month|season|year)|latest|recent|new releases?)\b/i;

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
