# CareCard: prototype

CareCard is a health insurance paperwork copilot. This investor demo is a working web prototype.

## What it does
- **Family cards**: scan an insurance card photo. On-device OCR (Tesseract.js) reads the payer, plan type, member ID, group number, and RxBIN.
- **Verify**: a call script for the doctor's office, plus a saved proof receipt with the date, the staff member's name, and a reference number.
- **Bills**: compares the bill to the EOB line by line. It flags duplicate charges, amounts above what the EOB says you owe, and out-of-network processing that contradicts a logged call.
- **Appeals**: drafts an appeal letter with the proof attached, shows the deadline, and lets you copy, download, or print it.

## Tech
Static HTML, CSS, and JS. No build step and no backend. Data is stored in the browser's localStorage. Card photos are read in the browser and never uploaded.

## Run locally
Open `index.html`, or run `python -m http.server` in this folder.

## Deploy
Push this folder to a GitHub repo and import it in Vercel. Set Framework Preset to "Other"; no build command is needed.

Prototype by Ikshana Solutions LLC. Not medical, legal, or financial advice.
