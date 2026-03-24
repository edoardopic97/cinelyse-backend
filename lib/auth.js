const admin = require("firebase-admin");

require("./firebase");

async function verifyAuth(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    return await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  } catch {
    return null;
  }
}

module.exports = { verifyAuth };
