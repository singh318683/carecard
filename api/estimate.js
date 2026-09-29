// POST /api/estimate  { service, network: "in"|"out", zip?, card, coverage, planSummary, example }
// Claude supplies typical prices (split into billable parts) and the plan's cost-sharing rule
// for each part as numbers. The browser does the arithmetic so every step is visible.

const { callClaude, parseJson, sendError } = require("./_claude");

const SCHEMA = `{
  "service": "clear name of the service, e.g. MRI of the knee without contrast",
  "setting": "where it usually happens, e.g. freestanding imaging center or hospital outpatient",
  "plan": {
    "deductible": 1000,
    "outOfPocketMax": 4500,
    "planKind": "major medical | fixed indemnity | short-term | unknown",
    "source": "where the plan numbers came from: coverage document | card | example | not found"
  },
  "components": [
    {
      "name": "Facility fee",
      "priceLow": 400,
      "priceHigh": 1200,
      "covered": true,
      "copay": 0,
      "coinsurance": 0.2,
      "deductibleApplies": true,
      "fixedBenefit": null,
      "ruleText": "20% after deductible",
      "ruleSource": "coverage document | card | typical for this plan type (assumed)"
    }
  ],
  "priorAuth": false,
  "priorAuthNote": "",
  "assumptions": ["short sentence"],
  "tips": ["short, specific money-saving tip"],
  "priceNote": "one sentence on what the price range represents"
}`;

const SYSTEM = `You are CareCard's cost estimator for U.S. health insurance. Given a service and the member's plan, return the inputs for a cost calculation. Do NOT calculate what the member pays; the app does that.

Prices:
- Split the service into the parts that are billed separately (e.g. delivery: hospital facility stay, obstetrician professional fee, anesthesia; MRI: technical/facility fee and radiologist reading fee; ER visit: facility fee and ER physician fee, plus typical labs/imaging only if commonly included). Use 1-4 components.
- For in-network, give a realistic range of insurer-negotiated (allowed) amounts in U.S. dollars as plain numbers. For out-of-network, give typical billed charges (higher). If a ZIP is given, adjust for that region's price level. Use low = a lower-cost setting, high = a hospital-based or high-cost setting.

Plan rules, per component:
- Read the member's coverage document first, then the card. Use the rule for the matching service line (e.g. "Diagnostic test (x-ray, blood work)", "Imaging (CT/PET scans, MRIs)", "Emergency room care", "Hospital stay: facility fee / physician fee", "Childbirth/delivery"). Say in ruleSource where it came from; when neither states it, use a typical rule for the plan type and mark it "(assumed)".
- copay: dollars or 0. coinsurance: member's share as a fraction 0-1 (20% = 0.2) or 0. deductibleApplies: true/false. covered: false if the plan excludes it. fixedBenefit: for fixed-indemnity plans, the dollar amount the plan pays for this component, else null.
- Copays usually apply once per visit: put the ER or office copay on one component only, with 0 on the others unless the plan says otherwise. If the plan says the ER copay covers all ER services, set the other ER components to copay 0, coinsurance 0, deductibleApplies false.
- Preventive services in network on ACA plans: copay 0, coinsurance 0, deductibleApplies false.
- plan.deductible and plan.outOfPocketMax: the individual in-network (or out-of-network if network is "out") amounts as numbers, or null if not stated anywhere.

Keep assumptions and tips short (at most 4 each). Mention prior authorization when the plan or common practice requires it. Reply with only JSON in this shape:
${SCHEMA}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });
  try {
    const body = req.body || {};
    const service = String(body.service || "").trim().slice(0, 200);
    if (!service) return res.status(400).json({ code: "bad_request", error: "Pick or type a service to estimate." });
    const network = body.network === "out" ? "out" : "in";
    const zip = /^\d{5}$/.test(String(body.zip || "")) ? String(body.zip) : "";

    const card = body.card && typeof body.card === "object" ? { ...body.card } : {};
    delete card.memberId;
    const plan = body.example
      ? "The member has not loaded their own card; this is EXAMPLE plan data. Use it, and set plan.source to \"example\"."
      : "The member's plan:";
    const text = `Service to estimate: ${service}
Network: ${network === "in" ? "in-network provider" : "out-of-network provider"}
${zip ? `Member ZIP code: ${zip}` : "No ZIP given; use U.S. national typical prices."}

${plan}
Card: ${JSON.stringify(card).slice(0, 5000)}
Plan summary: ${String(body.planSummary || "").slice(0, 1500)}
Coverage: ${body.coverage ? JSON.stringify(body.coverage).slice(0, 12000) : "No coverage document uploaded."}`;

    const { text: reply, stopReason } = await callClaude({ system: SYSTEM, messages: [{ role: "user", content: text }], maxTokens: 16000, effort: "medium" });
    let data = parseJson(reply);
    if (!data) {
      console.error("Unparseable estimate", { stopReason, start: reply.slice(0, 300) });
      if (stopReason === "max_tokens") return res.status(502).json({ code: "too_long", error: "The estimate ran out of room." });
      const fix = await callClaude({
        system: "Convert the text you are given into one valid JSON object with the same structure. Reply with only the JSON.",
        messages: [{ role: "user", content: reply.slice(0, 30000) }], maxTokens: 6000, thinking: false,
      });
      data = parseJson(fix.text);
      if (!data) return res.status(502).json({ code: "invalid_json", error: "Could not read the estimate." });
    }
    data.network = network;
    res.status(200).json(data);
  } catch (err) {
    sendError(res, err);
  }
};
