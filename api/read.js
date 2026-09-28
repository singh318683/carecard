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
  "coverage": {
    "source": "document title, e.g. Summary of Benefits and Coverage 2026",
    "services": [{"service": "Specialist visit", "inNetwork": "$50 copay", "outOfNetwork": "40% after deductible", "notes": "short limit or condition", "priorAuth": false}],
    "notCovered": ["..."],
    "watchOut": ["limits, visit caps, waiting periods, referral rules, fixed-indemnity or short-term plan warnings"]
  },
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
6. If a coverage document is provided: if it describes several plans or options, use the one that matches the card or what the person typed, and name it in coverage.source. Fill "coverage" with up to 15 of the most useful services (doctor visits, specialist, urgent care, ER, hospital stay, imaging, lab, generic and brand drugs, mental health, maternity, physical therapy, preventive care, plus anything the person mentioned). Copy costs exactly as written. Set priorAuth true only when the document says preauthorization/prior approval is required. Also fill card.deductible and card.outOfPocketMax from the document when the card lacks them. If the document shows this is a fixed-indemnity, limited-benefit or short-term plan rather than ACA major medical, say so clearly in planSummary and add a high-priority recommendation. Base recommendations on the document too.
   If no coverage document is provided, set "coverage": null.
Keep it compact: notes under 15 words, each notCovered/watchOut item under 20 words, at most 10 notCovered and 8 watchOut items. Use plain strings and escape any double quotes inside strings.
If the input is not an insurance card or coverage document, or is unreadable, set "readable": false and explain in "issue".

Reply with only JSON in this shape, no other text:
${SCHEMA}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });

  try {
    const body = req.body || {};
    const images = Array.isArray(body.images) ? body.images.slice(0, 2) : [];
    const typed = String(body.typed || "").slice(0, 4000);
    const context = String(body.context || "").slice(0, 1000);
    const doc = body.doc && typeof body.doc === "object" ? body.doc : null;

    if (!images.length && !typed.trim() && !doc) {
      return res.status(400).json({ code: "bad_request", error: "Add a photo of your card or type what it says." });
    }
    for (const img of images) {
      if (!img || !ALLOWED.includes(img.media_type) || typeof img.data !== "string") {
        return res.status(400).json({ code: "image_rejected", error: "Unsupported image." });
      }
    }

    const content = [];
    let docNote = "";
    if (doc) {
      if (doc.kind === "text" && typeof doc.text === "string") {
        docNote = `\n\nMy coverage document${doc.name ? ` (${String(doc.name).slice(0, 120)})` : ""}${doc.truncated ? ", first part only" : ""}:\n<document>\n${doc.text.slice(0, 60000)}\n</document>`;
      } else if (doc.kind === "pdf" && typeof doc.data === "string") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data } });
        docNote = "\n\nThe attached PDF is my coverage document.";
      } else if (doc.kind === "images" && Array.isArray(doc.images)) {
        const pages = doc.images.slice(0, 6).filter((img) => img && ALLOWED.includes(img.media_type) && typeof img.data === "string");
        pages.forEach((img) => content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }));
        docNote = `\n\nThe first ${pages.length} image(s) are pages of my coverage document.`;
      }
    }
    images.forEach((img) => content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } }));

    let text = images.length
      ? `The ${doc && doc.kind === "images" ? "last" : ""} ${images.length === 2 ? "two images are the front and back" : "image is one side"} of my health insurance card.`.replace("The  ", "The ")
      : typed.trim() ? `Here is what my insurance card says:\n${typed}` : "I don't have my card handy, only the coverage document.";
    text += docNote;
    if (images.length && typed.trim()) text += `\n\nI also typed this from the card:\n${typed}`;
    if (context.trim()) text += `\n\nWhat's coming up for me: ${context}\nTailor the recommendations to this.`;
    content.push({ type: "text", text });

    const { text: reply, stopReason } = await callClaude({ system: SYSTEM, messages: [{ role: "user", content }], maxTokens: doc ? 12000 : 4000 });
    let data = parseJson(reply);

    if (!data) {
      console.error("Unparseable reply", { stopReason, length: reply.length, start: reply.slice(0, 300), end: reply.slice(-300) });
      if (stopReason === "max_tokens") {
        return res.status(502).json({ code: "too_long", error: "The document produced too long a reading." });
      }
      // One repair attempt: ask Claude to turn its own reply into valid JSON.
      const fix = await callClaude({
        system: "Convert the text you are given into one valid JSON object that follows the same structure. Fix quoting and escaping, drop anything outside the object. Reply with only the JSON.",
        messages: [{ role: "user", content: reply.slice(0, 60000) }],
        maxTokens: 12000,
      });
      data = parseJson(fix.text);
      if (!data) return res.status(502).json({ code: "invalid_json", error: "Could not parse the reading." });
    }

    res.status(200).json(data);
  } catch (err) {
    sendError(res, err);
  }
};
