// POST /api/providers  { zip?: "72201", lat?: number, lng?: number, radiusMiles: number, category: string, custom?: string }
// Finds the highest-rated providers of one category within the radius, using Google Places (New) Text Search.

const { lookupNpi } = require("./_npi");

const CATEGORIES = {
  primary: "primary care doctor",
  urgent: "urgent care clinic",
  er: "hospital emergency room",
  pediatrics: "pediatrician",
  obgyn: "OB-GYN obstetrician gynecologist",
  dermatology: "dermatologist",
  orthopedics: "orthopedic doctor",
  cardiology: "cardiologist",
  mental: "mental health counseling psychiatrist",
  imaging: "MRI CT imaging center",
  lab: "medical lab blood test",
  pt: "physical therapy clinic",
  pharmacy: "pharmacy",
};

const FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location",
  "places.rating", "places.userRatingCount", "places.nationalPhoneNumber",
  "places.googleMapsUri", "places.websiteUri", "places.businessStatus",
  "places.currentOpeningHours.openNow", "places.primaryTypeDisplayName",
].join(",");

const cache = new Map(); // warm-instance cache, 1 hour
const TTL = 60 * 60 * 1000;

function milesBetween(a, b) {
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Ranks a 4.9 with 8 reviews below a 4.7 with 600 (Bayesian average).
function score(rating, count) {
  const m = 25, prior = 4.0;
  return (count / (count + m)) * rating + (m / (count + m)) * prior;
}

async function geocodeZip(zip) {
  const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!r.ok) return null;
  const d = await r.json();
  const p = d.places && d.places[0];
  return p ? { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), label: `${p["place name"]}, ${p["state abbreviation"]} ${zip}` } : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ code: "bad_request", error: "Use POST" });
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return res.status(500).json({ code: "no_places_key", error: "GOOGLE_PLACES_API_KEY is not set" });

  try {
    const body = req.body || {};
    const radiusMiles = Math.min(50, Math.max(1, Number(body.radiusMiles) || 10));
    const custom = String(body.custom || "").trim().slice(0, 60);
    const query = custom || CATEGORIES[body.category];
    if (!query) return res.status(400).json({ code: "bad_request", error: "Pick a category." });

    let origin = null;
    if (Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
      origin = { lat: body.lat, lng: body.lng, label: "your location" };
    } else if (/^\d{5}$/.test(String(body.zip || ""))) {
      origin = await geocodeZip(String(body.zip));
      if (!origin) return res.status(400).json({ code: "bad_zip", error: "ZIP code not found." });
    } else {
      return res.status(400).json({ code: "bad_zip", error: "Enter a 5-digit ZIP code." });
    }

    const cacheKey = [origin.lat.toFixed(3), origin.lng.toFixed(3), radiusMiles, query.toLowerCase()].join("|");
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL) return res.status(200).json(hit.data);

    // Bounding box around the circle; results are filtered to the true radius below.
    const dLat = radiusMiles / 69;
    const dLng = radiusMiles / (69 * Math.cos((origin.lat * Math.PI) / 180));
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 20,
        locationRestriction: {
          rectangle: {
            low: { latitude: origin.lat - dLat, longitude: origin.lng - dLng },
            high: { latitude: origin.lat + dLat, longitude: origin.lng + dLng },
          },
        },
      }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      console.error("Places error", r.status, d);
      return res.status(502).json({ code: "places_error", error: (d && d.error && d.error.message) || `Places API error ${r.status}` });
    }

    const results = (d.places || [])
      .filter((p) => p.location && p.businessStatus !== "CLOSED_PERMANENTLY" && p.businessStatus !== "CLOSED_TEMPORARILY")
      .map((p) => ({
        name: p.displayName && p.displayName.text,
        type: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text,
        rating: p.rating || null,
        reviews: p.userRatingCount || 0,
        address: p.formattedAddress,
        phone: p.nationalPhoneNumber || "",
        maps: p.googleMapsUri || "",
        website: p.websiteUri || "",
        openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null,
        miles: Math.round(milesBetween(origin, { lat: p.location.latitude, lng: p.location.longitude }) * 10) / 10,
      }))
      .filter((p) => p.name && p.miles <= radiusMiles && p.rating)
      .sort((a, b) => score(b.rating, b.reviews) - score(a.rating, a.reviews))
      .slice(0, 6);

    // Add NPI numbers from the free CMS registry (in parallel; a miss just leaves npi null).
    await Promise.all(results.map(async (p) => {
      try { p.npi = await lookupNpi(p); } catch (_) { p.npi = null; }
    }));

    const data = { origin: origin.label, radiusMiles, query, results };
    cache.set(cacheKey, { at: Date.now(), data });
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ code: "upstream_error", error: err.message });
  }
};
