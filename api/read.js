// POST /api/read  { images: [{media_type, data(base64)}], typed?: string, context?: string }
// Reads an insurance card and returns structured fields + recommendations.

const { callClaude, parseJson, sendError } = require("./_claude");

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const SCHEMA = `{
  "readable": true,
  "issue": null,
  "card": {
    "insurer": "", "planName": "", "planType": "HMO | PPO | EPO | POS | HDHP | Medicare Advantage | Medicaid | Other | Unknown",
    "network": "", "memberName": "", "memberId": "", "groupNumber": "", "effectiveDate": "",
    "rx": {"bin": "", "pcn": "", "group": ""},
    "copays": [{"label": "Primary care", "amount": "$25"}],
    "deductible": "", "outOfPocketMax": "",
    "phones": [{"label": "Member services", "number": ""}],
    "website": ""
  },
  "planSummary": "2-3 plain sentences on how this plan works for the member",
  "recommendations": [{"title": "", "detail": "1-3 sentences, specific to this card", "priority": "high | medium | low", "category": "Save money | Stay in network | Prescriptions | Paperwork | Coverage check"}],
  "questionsForInsurer": ["..."],
  "missing": ["fields a typical card has that this one doesn't show"]
}`;

const SYSTEM = `You are CareCard, a helpful health insurance explainer for a U.S. consumer.

Tasks:
1. Read every field printed on the card exactly as shown. Use empty string "" for anything not visible. Never guess numbers.
2. Infer planType only from what's printed (e.g. "PPO", "HMO", "HSA-eligible" means HDHP). Otherwise "Unknown".
3. Write a planSummary in plain English for someone who finds insurance confusing.
4. Give 4-6 practical recommendations tailored to THIS card (its copay spread, plan type rules like referrals for HMO, HSA if HDHP, Rx codes, network name, telehealth if listed). Mark priority high only for things that can save real money or avoid a denied claim.
5. Give 3-5 questions to ask member services.
If the input is not an insurance card or is unreadable, set "readable": false and explain in "issue".

Reply with only JSON in this shape, no other text:
${SCHEMA}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });

  try {
    const body = req.body || {};
    const images = Array.isArray(body.images) ? body.images.slice(0, 2) : [];
    const typed = String(body.typed || "").slice(0, 4000);
    const context = String(body.context || "").slice(0, 1000);

    if (!images.length && !typed.trim()) {
      return res.status(400).json({ code: "bad_request", error: "Add a photo of your card or type what it says." });
    }
    for (const img of images) {
      if (!img || !ALLOWED.includes(img.media_type) || typeof img.data !== "string") {
        return res.status(400).json({ code: "image_rejected", error: "Unsupported image." });
      }
    }

    const content = [];
    images.forEach((img) => content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }));

    let text = images.length
      ? `Attached ${images.length === 2 ? "are the front and back" : "is one side"} of my health insurance card.`
      : `Here is what my insurance card says:\n${typed}`;
    if (images.length && typed.trim()) text += `\n\nI also typed this from the card:\n${typed}`;
    if (context.trim()) text += `\n\nWhat's coming up for me: ${context}\nTailor the recommendations to this.`;
    content.push({ type: "text", text });

    const reply = await callClaude({ system: SYSTEM, messages: [{ role: "user", content }], maxTokens: 2500 });
    const data = parseJson(reply);
    if (!data) return res.status(502).json({ code: "invalid_json", error: "Could not parse the reading." });

    res.status(200).json(data);
  } catch (err) {
    sendError(res, err);
  }
};
