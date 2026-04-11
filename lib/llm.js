const GEMINI_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;
const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.0-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(model, systemPrompt, userPrompt, { useSearch = false, forceJSON = false } = {}) {
  const generationConfig = { thinkingConfig: { thinkingBudget: 0 } };
  if (forceJSON) generationConfig.responseMimeType = "application/json";

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig,
  };
  if (useSearch) body.tools = [{ googleSearch: {} }];

  const res = await fetch(`${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    const status = res.status;
    console.error(`[LLM] ${model} error ${status}:`, err.substring(0, 300));
    throw Object.assign(new Error(`Gemini API error: ${status}`), { status });
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter(p => p.text).map(p => p.text).join("");
}

// Single call with one fallback attempt. Max 2 Gemini calls.
async function callWithFallback(systemPrompt, userPrompt, opts) {
  try {
    return await callGemini(PRIMARY_MODEL, systemPrompt, userPrompt, opts);
  } catch (e) {
    if (e.status === 503 || e.status === 429) {
      console.log(`[LLM] ${PRIMARY_MODEL} unavailable, falling back to ${FALLBACK_MODEL}`);
      return await callGemini(FALLBACK_MODEL, systemPrompt, userPrompt, { ...opts, useSearch: false });
    }
    throw e;
  }
}

// No grounding: 1 call (+ 1 fallback if 503) = max 2 calls
// With grounding: 1 grounding call (+ 1 fallback) + 1 JSON conversion call (+ 1 fallback) = max 4 calls
// But realistically: 1 grounding + 1 conversion = 2 calls
async function invokeLLM(systemPrompt, userPrompt, { useSearch = false } = {}) {
  if (!GEMINI_API_KEY) throw new Error("Gemini API key not configured");

  if (!useSearch) {
    return await callWithFallback(systemPrompt, userPrompt, { forceJSON: true });
  }

  // Step 1: Grounded retrieval (plain text)
  const groundingPrompt = "List the most relevant and accurate results for the user's query. Return a plain text numbered list of titles with year and type (movie or series). Nothing else.";
  const groundedText = await callWithFallback(groundingPrompt, userPrompt, { useSearch: true });

  // Step 2: Convert to structured JSON (no grounding, forced JSON)
  if (groundedText && groundedText.trim()) {
    const convertPrompt = systemPrompt + "\n\nUse the following research data as your primary source:\n" + groundedText;
    return await callWithFallback(convertPrompt, userPrompt, { forceJSON: true });
  }

  // Grounding returned nothing — single direct call
  return await callWithFallback(systemPrompt, userPrompt, { forceJSON: true });
}

module.exports = { invokeLLM };
