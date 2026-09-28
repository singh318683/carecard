// Shared helper for calling the Claude API from Vercel serverless functions.
// Files starting with "_" are not exposed as routes by Vercel.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

async function callClaude({ system, messages, maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const err = new Error("ANTHROPIC_API_KEY is not set");
    err.code = "no_key";
    err.status = 500;
    throw err;
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error && data.error.message) || `Claude API error ${res.status}`);
    err.code = res.status === 429 || res.status === 529 ? "rate_limited" : "upstream_error";
    err.status = res.status === 429 || res.status === 529 ? 429 : 502;
    throw err;
  }

  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, stopReason: data.stop_reason };
}

// Pull one JSON object out of a reply, tolerating code fences or a stray sentence.
function parseJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch (_) {} }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {} }
  return null;
}

function sendError(res, err) {
  console.error(err);
  res.status(err.status || 500).json({ code: err.code || "upstream_error", error: err.message });
}

module.exports = { callClaude, parseJson, sendError };
