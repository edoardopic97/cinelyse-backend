const crypto = require("crypto");
const { db } = require("./firebase");

const COLLECTION = "searchCache";

function cacheKey(query, category) {
  const normalized = `${query.trim().toLowerCase()}:${category}`;
  return crypto.createHash("md5").update(normalized).digest("hex");
}

async function getCachedResults(query, category) {
  try {
    const doc = await db.collection(COLLECTION).doc(cacheKey(query, category)).get();
    if (!doc.exists) return null;
    const data = doc.data();
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
      createdAt: Date.now(),
    });
  } catch (err) {
    console.error("[Cache] Write error:", err.message);
  }
}

module.exports = { getCachedResults, setCachedResults };
