// POST /api/bill  { files: [{kind:"text",text,name} | {kind:"pdf",data,name} | {kind:"image",media_type,data}], note?, card, coverage, planSummary, example }
// Checks a medical bill, receipt or EOB against the member's card and coverage.

const { callClaude, parseJson, sendError } = require("./_claude");

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const SCHEMA = `{
  "documentType": "Itemized bill | Statement | Payment receipt | Explanation of Benefits (EOB) | Other",
  "provider": "", "patient": "", "dateOfService": "", "serviceType": "",
  "lines": [{"description": "", "code": "CPT/HCPCS code if shown", "billed": "", "insurancePaid": "", "youOwe": ""}],
  "totals": {"billed": "", "adjustments": "", "insurancePaid": "", "youOwe": "", "youPaid": ""},
  "billedToPatient": 0,
  "patientShouldOwe": null,
  "potentialSavings": 0,
  "issues": [{"title": "short name of the problem", "amount": 0, "affects": "you | your plan", "confidence": "clear | likely | question", "lines": "which bill line(s)", "detail": "1-2 sentences with the evidence"}],
  "expected": "What this plan says the member should pay for this kind of service, e.g. 'In-network lab: counts toward $500 deductible, then 10%'",
  "verdict": "looks_right | needs_check | possible_error | cannot_verify",
  "verdictReason": "1-2 plain sentences",
  "checks": [{"label": "short check name", "status": "pass | warn | fail | unknown", "detail": "1-2 sentences"}],
  "nextSteps": ["concrete action"],
  "missingDocs": ["documents that would settle it, e.g. EOB for 05/14/2026 from the insurer portal"],
  "callScript": "What to say when calling the provider's billing office or the insurer, 3-5 sentences, first person"
}`;

const SYSTEM = `You are CareCard's bill checker for U.S. health insurance. You compare a medical bill, statement, payment receipt or EOB with the member's plan.

Run these checks when the information allows (mark "unknown" when it doesn't, never guess amounts):
- Patient and date: is the patient on this plan and the date within the plan's coverage period?
- Network: is the provider likely in network for this plan? Say "unknown - confirm in the insurer directory" unless the documents show it.
- Cost-sharing: does the amount the member owes match the plan's copay / deductible / coinsurance for this service type?
- Preventive care: if the service could be preventive (annual physical labs, screenings, vaccines), note that ACA-compliant plans cover in-network preventive care at $0 and a charge may mean wrong coding. Fixed-indemnity or short-term plans are exempt.
- Bill vs EOB: the member should never be billed more than the EOB's "patient responsibility". If there is no EOB, say it is needed.
- Duplicates (same code, same date), and math errors (quantity x unit price must equal the line amount).
- Unbundling: lab panels already include their components (e.g. CMP 80053 includes glucose 82947, creatinine 82565, BUN, electrolytes; BMP 80048 likewise). Routine supplies are usually included in facility visit charges.
- Time-based units: compare hourly/daily units (e.g. observation G0378 per hour, room per day) with arrival and discharge times on the bill.
- Balance billing: an in-network provider may only collect the EOB "patient responsibility". Any amount above it (often "charges minus insurance payment" with no contractual adjustment) is an overcharge. Lines the EOB marks "member not responsible" must not be billed to the patient.
- Charges after the out-of-pocket maximum.

Money fields: "billedToPatient" is what the bill asks the member to pay (a number, 0 if none). "patientShouldOwe" is the correct member amount from the EOB or plan rules (a number), or null when it can't be determined. "potentialSavings" = billedToPatient - patientShouldOwe when both are known, else the sum of clear issues that affect the member (never negative).
"issues" lists each specific problem with its dollar amount as billed (a number; 0 if not quantifiable). "affects": "you" when the member is being asked to pay it, "your plan" when the insurer paid for something wrong (it still raises premiums and is worth reporting). "confidence": "clear" when the documents prove it, "likely" when strongly suggested, "question" when it is only worth asking about (e.g. a high visit level). Issues may overlap (a line the EOB denied is also inside a balance-billing amount); that is fine because the headline uses potentialSavings, never the sum of issues. Order issues by amount, largest first.
- Surprise billing: if relevant (ER, out-of-network provider at in-network facility), mention No Surprises Act protections.

Verdict rules: "looks_right" only when the documents show the amount matches the plan. "possible_error" when something conflicts. "needs_check" when it is plausible but one document (usually the EOB) is missing. "cannot_verify" when the plan details are missing.
Be concise and plain. Use plain strings and escape double quotes. Reply with only JSON in this shape:
${SCHEMA}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });

  try {
    const body = req.body || {};
    const files = Array.isArray(body.files) ? body.files.slice(0, 6) : [];
    if (!files.length) return res.status(400).json({ code: "bad_request", error: "Add a bill, receipt or EOB first." });

    const content = [];
    const textParts = [];
    for (const f of files) {
      if (!f || typeof f !== "object") continue;
      if (f.kind === "text" && typeof f.text === "string") {
        textParts.push(`<document name="${String(f.name || "bill").slice(0, 100).replace(/"/g, "")}">\n${f.text.slice(0, 30000)}\n</document>`);
      } else if (f.kind === "pdf" && typeof f.data === "string") {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      } else if (f.kind === "image" && ALLOWED.includes(f.media_type) && typeof f.data === "string") {
        content.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
      }
    }
    if (!content.length && !textParts.length) return res.status(400).json({ code: "bad_request", error: "Those files couldn't be read." });

    const card = body.card && typeof body.card === "object" ? { ...body.card } : {};
    delete card.memberId;
    const plan = body.example
      ? "The member has NOT uploaded their own card yet; the plan data below is EXAMPLE data. Say the plan could not be checked and ask them to upload their card and coverage document."
      : "The member's plan:";
    let text = `The attached file(s) are a medical bill, statement, receipt or EOB I want checked.\n\n${plan}\nCard: ${JSON.stringify(card).slice(0, 5000)}\nPlan summary: ${String(body.planSummary || "").slice(0, 1500)}\nCoverage: ${body.coverage ? JSON.stringify(body.coverage).slice(0, 12000) : "No coverage document uploaded."}`;
    if (textParts.length) text += `\n\nBill text:\n${textParts.join("\n\n")}`;
    if (body.note) text += `\n\nWhat I know about this visit: ${String(body.note).slice(0, 1000)}`;
    content.push({ type: "text", text });

    const { text: reply, stopReason } = await callClaude({ system: SYSTEM, messages: [{ role: "user", content }], maxTokens: 24000, effort: "medium" });
    let data = parseJson(reply);
    if (!data) {
      console.error("Unparseable bill reply", { stopReason, start: reply.slice(0, 300) });
      if (stopReason === "max_tokens") return res.status(502).json({ code: "too_long", error: "The bill was too long to check in one go." });
      const fix = await callClaude({
        system: "Convert the text you are given into one valid JSON object with the same structure. Reply with only the JSON.",
        messages: [{ role: "user", content: reply.slice(0, 40000) }],
        maxTokens: 8000,
        thinking: false,
      });
      data = parseJson(fix.text);
      if (!data) return res.status(502).json({ code: "invalid_json", error: "Could not parse the bill check." });
    }
    res.status(200).json(data);
  } catch (err) {
    sendError(res, err);
  }
};
