// POST /api/ask  { card, planSummary, example, messages: [{role, content}] }
// Answers a follow-up question about the member's card.

const { callClaude, sendError } = require("./_claude");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });

  try {
    const body = req.body || {};
    const card = body.card && typeof body.card === "object" ? body.card : {};
    delete card.memberId; // never needed to answer questions

    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({ code: "bad_request", error: "Ask a question first." });
    }

    const system = `You are CareCard, a friendly U.S. health insurance explainer. Answer using this member's card and coverage data${body.example ? " (this is EXAMPLE data, not the person's real card; say so if relevant)" : ""}:
${JSON.stringify(card).slice(0, 6000)}
Plan summary: ${String(body.planSummary || "").slice(0, 1000)}
${body.coverage ? "Coverage from their benefits document:\n" + JSON.stringify(body.coverage).slice(0, 12000) : "They have not uploaded a coverage document; if a question needs one, suggest uploading their Summary of Benefits and Coverage."}

Be concise (under 150 words), plain English, no markdown headers. When the card doesn't say, explain what's typical and tell them to confirm with the member services number on the card. Never claim to know exact coverage.`;

    const { text } = await callClaude({ system, messages, maxTokens: 800 });
    res.status(200).json({ text: text || "I couldn't come up with an answer. Try rephrasing." });
  } catch (err) {
    sendError(res, err);
  }
};
