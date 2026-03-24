const admin = require("firebase-admin");
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

  const { userId, type, message, extra } = req.body || {};
  if (!userId || !message) {
    return res.status(400).json({ error: "userId and message are required" });
  }

  // Validate sender-recipient relationship
  if (user.uid !== userId) {
    const friendDoc = await db.collection("users").doc(user.uid).collection("friends").doc(userId).get();
    const pendingReq = await db.collection("users").doc(userId).collection("friendRequests")
      .where("fromUserId", "==", user.uid).where("status", "==", "pending").limit(1).get();
    // Also allow if the target just accepted (sender is now a friend of target)
    const reverseFriend = await db.collection("users").doc(userId).collection("friends").doc(user.uid).get();
    if (!friendDoc.exists && pendingReq.empty && !reverseFriend.exists) {
      return res.status(403).json({ error: "No relationship with target user" });
    }
  }

  try {
    // Write notification doc server-side
    const notifRef = db.collection("users").doc(userId).collection("notifications").doc();
    await notifRef.set({
      id: notifRef.id,
      type: type || "general",
      message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(extra || {}),
    });

    // Send push notification
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) return res.status(200).json({ sent: false, notifId: notifRef.id, reason: "User not found" });

    const pushToken = userDoc.data().pushToken;
    if (!pushToken) return res.status(200).json({ sent: false, notifId: notifRef.id, reason: "No push token" });

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title: "CINELYSE",
        body: message,
      }),
    });

    const result = await response.json();
    return res.status(200).json({ sent: true, notifId: notifRef.id, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
