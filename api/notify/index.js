const { db } = require("../../lib/firebase");
const { verifyAuth } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const { userId, title, body } = req.body || {};
  if (!userId || !title || !body) {
    return res.status(400).json({ error: "userId, title, and body are required" });
  }

  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: "User not found" });

    const pushToken = userDoc.data().pushToken;
    if (!pushToken) return res.status(200).json({ sent: false, reason: "No push token" });

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title,
        body,
      }),
    });

    const result = await response.json();
    return res.status(200).json({ sent: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
