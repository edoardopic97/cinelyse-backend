const GEMINI_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

async function invokeLLM(systemPrompt, userPrompt, { useSearch = false } = {}) {
  if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      { role: "user", parts: [{ text: userPrompt }] },
    ],
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} – ${err}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text).map(p => p.text).join("") || "";
}

module.exports = { invokeLLM };
