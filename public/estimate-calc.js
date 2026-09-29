// CareCard cost calculator. Pure arithmetic, no network calls.
// Order per component: deductible first, then copay, then coinsurance on the rest;
// the running total is capped at the remaining out-of-pocket maximum.
(function (root) {
  const n = (x) => (typeof x === "number" && isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && isFinite(Number(x.replace(/[$,%\s]/g, ""))) ? Number(x.replace(/[$,%\s]/g, "")) : null);
  const r2 = (x) => Math.round(x * 100) / 100;

  function coinsFraction(c) {
    const v = n(c);
    if (v === null || v < 0) return 0;
    return v > 1 ? Math.min(v / 100, 1) : v; // accept 20 or 0.2
  }

  /**
   * @param {Array} components  [{name, priceLow, priceHigh, covered, copay, coinsurance, deductibleApplies, fixedBenefit, ruleText}]
   * @param {Object} plan       {deductible, outOfPocketMax}
   * @param {Object} paid       {deductible, outOfPocket} already spent this plan year
   * @param {"low"|"high"} which
   */
  function calc(components, plan, paid, which) {
    const ded = n(plan && plan.deductible), oop = n(plan && plan.outOfPocketMax);
    const dedPaid = Math.max(0, n(paid && paid.deductible) || 0);
    const oopPaidRaw = n(paid && paid.outOfPocket);
    const oopPaid = Math.max(0, oopPaidRaw === null ? dedPaid : oopPaidRaw); // deductible spending counts toward the OOP max
    let dedLeft = ded === null ? 0 : Math.max(0, ded - dedPaid);
    let oopLeft = oop === null ? Infinity : Math.max(0, oop - oopPaid);
    const startDedLeft = dedLeft, startOopLeft = oopLeft;

    const rows = [];
    let total = 0, price = 0, capped = false;
    for (const c of components || []) {
      const p = Math.max(0, n(which === "high" ? c.priceHigh : c.priceLow) || 0);
      price += p;
      const row = { name: c.name || "Service", price: p, deductible: 0, copay: 0, coinsurance: 0, notCovered: 0, overBenefit: 0, you: 0, plan: 0, rule: c.ruleText || "" };

      if (c.covered === false) {
        row.notCovered = p; row.you = p;                      // excluded: member pays all, doesn't count toward OOP
      } else if (n(c.fixedBenefit) !== null) {
        const benefit = Math.min(p, Math.max(0, n(c.fixedBenefit)));
        row.overBenefit = p - benefit; row.you = p - benefit; // indemnity: plan pays a set amount, no OOP protection
      } else {
        const d = c.deductibleApplies ? Math.min(dedLeft, p) : 0;
        dedLeft -= d;
        const after = p - d;
        const co = Math.min(Math.max(0, n(c.copay) || 0), after);
        const coins = coinsFraction(c.coinsurance) * Math.max(0, after - co);
        let you = d + co + coins;
        if (you > oopLeft) { you = oopLeft; capped = true; }
        oopLeft -= you;
        row.deductible = d; row.copay = co; row.coinsurance = coins; row.you = you;
      }
      row.plan = p - row.you;
      Object.keys(row).forEach((k) => { if (typeof row[k] === "number") row[k] = r2(row[k]); });
      total += row.you;
      rows.push(row);
    }
    return {
      price: r2(price), you: r2(total), plan: r2(price - total), rows, capped,
      deductibleLeftBefore: ded === null ? null : r2(startDedLeft),
      deductibleLeftAfter: ded === null ? null : r2(dedLeft),
      oopLeftBefore: oop === null ? null : r2(startOopLeft),
      deductibleKnown: ded !== null, oopKnown: oop !== null,
    };
  }

  const api = { calc, coinsFraction };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CareCalc = api;
})(this);
