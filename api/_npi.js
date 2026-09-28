// Look up a provider's NPI in the free CMS NPPES NPI Registry (no key needed).
// Matching: name + location ZIP ("exact"), name + city ("likely"). Anything weaker is dropped.

const API = "https://npiregistry.cms.hhs.gov/api/?version=2.1";

const CREDENTIALS = /\b(M\.?D|D\.?O|N\.?P|P\.?A(-C)?|D\.?P\.?M|D\.?C|APRN|FNP(-C)?|DNP|PhD|LCSW|LPC|FACP|FAAFP|MBBS|RN|PT|DPT|OD|DDS|DMD)\b\.?/gi;
const ORG_HINTS = /\b(associates|group|center|centre|clinic|health|medical|medicine|care|hospital|practice|partners|pharmacy|labs?|imaging|urgent|physicians|llc|inc|pc|pa|therapy|services|university|institute|walgreens|cvs|quest|labcorp|docs)\b/i;
const STOP = new Set(["the", "of", "and", "at", "&", "-", "–", "llc", "inc", "pc", "pa"]);

function parseAddress(addr) {
  const m = String(addr || "").match(/,\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})/);
  return m ? { city: m[1].trim().toUpperCase(), state: m[2], zip: m[3] } : null;
}

// "Dr. Michael Smith, DO" -> {first:"MICHAEL", last:"SMITH"}; returns null for organizations
function parsePerson(name) {
  const raw = String(name || "");
  const hasDr = /^\s*dr\.?\s/i.test(raw);
  const hasCred = CREDENTIALS.test(raw); CREDENTIALS.lastIndex = 0;
  if (!hasDr && !hasCred) return null;
  const main = raw.split(/[-–|:(]/)[0];
  if (ORG_HINTS.test(raw.split(",")[0])) return null; // "Princeton Medical Group, PA" is a practice, not a person
  const words = main.replace(/^\s*dr\.?\s+/i, "").replace(CREDENTIALS, "").replace(/[.,]/g, " ")
    .split(/\s+/).filter(Boolean).filter((w) => !/^[A-Z]$/i.test(w)); // drop middle initials
  CREDENTIALS.lastIndex = 0;
  if (words.length < 2 || words.length > 4) return null;
  return { first: words[0].toUpperCase(), last: words[words.length - 1].toUpperCase() };
}

function orgQuery(name) {
  const words = String(name || "").split(/[-–|:(]/)[0].replace(/[^\w\s&']/g, " ").split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()));
  if (!words.length) return null;
  return words.slice(0, 2).join(" ") + "*";
}

async function query(params, timeoutMs = 4000) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}&${qs}`, { signal: ctl.signal });
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d.results) ? d.results : [];
  } catch (_) {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function pick(results, loc) {
  let best = null;
  for (const r of results) {
    if (r.basic && r.basic.status && r.basic.status !== "A") continue; // active only
    for (const a of r.addresses || []) {
      if (a.address_purpose !== "LOCATION") continue;
      const zip = String(a.postal_code || "").slice(0, 5);
      const conf = zip === loc.zip ? "exact" : String(a.city || "").toUpperCase() === loc.city && a.state === loc.state ? "likely" : null;
      if (conf === "exact") return { r, conf };
      if (conf && !best) best = { r, conf };
    }
  }
  return best;
}

function shape({ r, conf }) {
  const b = r.basic || {};
  const tax = (r.taxonomies || []).find((t) => t.primary) || (r.taxonomies || [])[0] || {};
  const name = r.enumeration_type === "NPI-2"
    ? b.organization_name
    : [b.first_name, b.last_name].filter(Boolean).join(" ") + (b.credential ? `, ${b.credential}` : "");
  return { number: r.number, name, specialty: tax.desc || "", match: conf };
}

async function lookupNpi(provider) {
  const loc = parseAddress(provider.address);
  if (!loc) return null;
  const person = parsePerson(provider.name);
  if (person) {
    const res = await query({ first_name: person.first, last_name: person.last, state: loc.state, enumeration_type: "NPI-1", limit: 50 });
    const hit = pick(res, loc);
    if (hit) return shape(hit);
  }
  const org = orgQuery(provider.name);
  if (org && org.replace("*", "").length >= 2) {
    const res = await query({ organization_name: org, postal_code: loc.zip, enumeration_type: "NPI-2", limit: 50 });
    const hit = pick(res, loc);
    if (hit) return shape(hit);
  }
  return null;
}

module.exports = { lookupNpi, parsePerson, orgQuery, parseAddress };
