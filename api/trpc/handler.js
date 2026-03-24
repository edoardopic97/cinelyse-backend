const { findMoviesFromQuery, directTitleSearch } = require("../../lib/movieSearch");
const { getCachedResults, setCachedResults } = require("../../lib/cache");
const { db } = require("../../lib/firebase");
const { verifyAuth } = require("../../lib/auth");

const MAX_DAILY_CREDITS = 5;
const MAX_DAILY_TITLE_SEARCHES = 50;
const UNLIMITED_UIDS = new Set([
  process.env.UNLIMITED_UIDS ? process.env.UNLIMITED_UIDS.split(",") : [],
].flat());

function localDateKey(tzOffset) {
  // tzOffset = minutes ahead of UTC (e.g. UTC+5 = 300, UTC-4 = -240)
  const now = new Date();
  const local = new Date(now.getTime() + (tzOffset ?? 0) * 60000);
  return local.toISOString().slice(0, 10);
}

async function checkCredits(uid, tzOffset) {
  if (!uid) return { allowed: false, remaining: 0 };
  if (UNLIMITED_UIDS.has(uid)) return { allowed: true, remaining: Infinity };

  const today = localDateKey(tzOffset);
  const ref = db.collection("users").doc(uid).collection("credits").doc(today);
  const snap = await ref.get();
  const used = snap.exists ? snap.data().used || 0 : 0;

  if (used >= MAX_DAILY_CREDITS) return { allowed: false, remaining: 0 };

  await ref.set({ used: used + 1, updatedAt: new Date() }, { merge: true });
  return { allowed: true, remaining: MAX_DAILY_CREDITS - used - 1 };
}

async function checkTitleSearchLimit(uid, tzOffset) {
  if (!uid) return { allowed: false, remaining: 0 };
  if (UNLIMITED_UIDS.has(uid)) return { allowed: true, remaining: Infinity };

  const today = localDateKey(tzOffset);
  const ref = db.collection("users").doc(uid).collection("titleSearches").doc(today);
  const snap = await ref.get();
  const used = snap.exists ? snap.data().used || 0 : 0;

  if (used >= MAX_DAILY_TITLE_SEARCHES) return { allowed: false, remaining: 0 };

  await ref.set({ used: used + 1, updatedAt: new Date() }, { merge: true });
  return { allowed: true, remaining: MAX_DAILY_TITLE_SEARCHES - used - 1 };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: { message: "Unauthorized" } });

  try {
    const input = req.body?.json || req.body;
    const query = input?.query;
    const category = input?.category || "all";
    const uid = user.uid;
    const aiMode = input?.aiMode === true || input?.aiMode === 'true';

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ error: { message: "Query is required" } });
    }

    const cacheKey = aiMode ? query : `title:${query}`;
    const cached = await getCachedResults(cacheKey, category);
    if (cached) {
      return res.status(200).json({
        result: { data: { json: { success: true, movies: cached, count: cached.length, cached: true } } },
      });
    }

    const tzOffset = typeof input?.tzOffset === "number" ? input.tzOffset : 0;

    if (aiMode) {
      const { allowed, remaining } = await checkCredits(uid, tzOffset);
      if (!allowed) {
        return res.status(429).json({
          error: { message: "Daily AI search limit reached", remaining: 0 },
        });
      }
    } else {
      const { allowed } = await checkTitleSearchLimit(uid, tzOffset);
      if (!allowed) {
        return res.status(429).json({
          error: { message: "Daily title search limit reached. Try again tomorrow!", remaining: 0 },
        });
      }
    }

    const movies = aiMode
      ? await findMoviesFromQuery(query.trim(), category)
      : await directTitleSearch(query.trim(), category);
    if (movies.length > 0) setCachedResults(cacheKey, category, movies, uid);

    if (!UNLIMITED_UIDS.has(uid)) {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const current = userSnap.exists ? (userSnap.data().totalSearches || 0) : 0;
      const newCount = current + 1;
      await userRef.set({ totalSearches: newCount, updatedAt: new Date() }, { merge: true });
      // Fan out to friends' denormalized docs
      const friendsSnap = await db.collection("users").doc(uid).collection("friends").get();
      if (!friendsSnap.empty) {
        const batch = db.batch();
        friendsSnap.docs.forEach((d) => {
          batch.set(
            db.collection("users").doc(d.id).collection("friends").doc(uid),
            { totalSearches: newCount },
            { merge: true }
          );
        });
        await batch.commit();
      }
    }

    return res.status(200).json({
      result: { data: { json: { success: true, movies, count: movies.length, cached: false } } },
    });
  } catch (err) {
    console.error("[API] Search error:", err);
    return res.status(500).json({ error: { message: err.message || "Search failed" } });
  }
};
