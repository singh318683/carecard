# CareCard

Upload a photo of your health insurance card. Claude reads it, lays out copays, deductible, Rx BIN/PCN/group and phone numbers, and gives plan-specific recommendations. There is also a box for follow-up questions.

## Structure

```
public/index.html   the whole front end (no build step)
api/read.js         POST /api/read: reads the card photo(s)
api/ask.js          POST /api/ask: answers follow-up questions
api/bill.js         POST /api/bill: checks a bill, receipt or EOB against the plan
api/providers.js    POST /api/providers: top-rated providers near a ZIP (Google Places)
api/_claude.js      shared Claude API helper (not a route)
api/_npi.js         NPI lookup in the free CMS NPPES registry (not a route)
vercel.json         function time limits (read 300 s, bill 180 s, others 60 s)
```

## Deploy on Vercel

1. Import this GitHub repo in Vercel (Framework preset: **Other**, no build command).
2. In **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` with a key from https://console.anthropic.com.
   You can also set `CLAUDE_MODEL` (default `claude-sonnet-5`).
   For provider search, also add `GOOGLE_PLACES_API_KEY` (Google Cloud project with **Places API (New)** enabled).
3. Redeploy.

## Notes

- Photos are resized in the browser (max 1568 px, JPEG) before upload, which keeps them under Vercel's 4.5 MB request limit.
- Coverage documents: text PDFs are read in the browser with pdf.js and sent as text (cheap). Scanned PDFs under 2.5 MB are sent as the file; bigger scans need page photos (up to 6).
- Nothing is stored. Images go from the browser to the function to the Claude API and are discarded.
- The member ID is masked on screen and never sent with follow-up questions.
- Anyone with the link spends your API credit. Before sharing widely, add rate limiting or a login, and set a spend limit in the Anthropic console.
- Provider search runs one Google Places Text Search per category tap (about $0.035 each after 1,000 free per month). Results are cached for an hour per location, radius and category.
- Each provider result gets an NPI number from the CMS NPI Registry (free, no key), matched by name plus ZIP ("exact") or city ("likely").
- Bill check: PDFs are sent as text when possible; about 2-5 cents per check with Sonnet 5. It is a guide, not a billing determination.
- Bill review PDF and dispute letter PDF are generated in the browser with jsPDF (no extra API call).
- Demo kit: a fictional card, plan summary, itemized hospital bill with planted overcharges, and EOB are available separately (carecard-demo-kit.zip).
- iPhone HEIC photos only open in Safari. In other browsers, upload a JPG or a screenshot.
