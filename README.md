# Vendor Quote Tool

Plain HTML/CSS/JS site for quoting dumpster/roll-off jobs — no build step, drop straight into a GitHub Pages repo root. Runs on the real Master Vendor Sheet — this is live vendor data, not sample/placeholder data.

## Files
- `index.html` — landing page (Sales / Admin / Add Vendor / Update Vendor)
- `sales.html`, `admin.html` — the two main pages
- `add-vendor.html`, `update-vendor.html` — vendor request forms (submit via Formspree)
- `css/styles.css` — all styling
- `js/data.js` — small loader that imports and combines `js/data-part1.js` through `data-part4.js` into `PRICING_RULES`, plus the other small constants (sizes, debris types, formula constants). Vendor data itself lives in the `data-partN.js` files. None of these should be hand-edited — they're all regenerated together every time the converter runs.
- `js/data-part1.js` … `data-part4.js` — the actual vendor pricing data, split into pieces purely so each individual file stays under GitHub's 25MB browser-upload limit (not a performance change — the site still loads the same total data either way). When uploading a new data export through GitHub's web UI, drag in `data.js` and all four `data-partN.js` files together; they're generated as a set.
- `js/quote-engine.js` — location matching and pricing logic
- `js/sales.js`, `js/admin.js` — the two main pages' controllers
- `js/vendor-request.js` — shared form-submission handling for Add/Update Vendor
- `tools/convert-vendor-sheet.py` — regenerates `js/data.js` from the Master Sheet

## Updating the data
Whenever there's a new version of the Master Sheet, run:

```
python3 tools/convert-vendor-sheet.py path/to/MasterSheet.xlsx js/data.js
```

This writes `js/data.js` plus `js/data-part1.js` through `data-part4.js` alongside it — all five need to be uploaded together.

Built against the real Master Sheet's column layout: `State, City, 10 yard,
15 yard, 20 yard, 30 yard, 40 yd, Pricing Model, Haul Rate, Tonnage Rate,
CnD Waste, Mixed Waste, Fuel Surcharge, Other, Delivery, Vendor, Phone,
Zipcodes by City, Sales Tax Rate`. If that layout ever changes, this script
is the one place that needs to change — nothing else in the site should.

## What the site currently does
- Matches by city/state (or a full state-average estimate when no vendor
  covers the exact city — see `stateEstimates`/`estimateForSize` in
  `quote-engine.js`).
- Zip-code search is **not implemented yet** — `ZIP_TO_LOCATION` in
  `data.js` is always empty, so every zip search shows the "try a city and
  state instead" note regardless of which zip is entered. Building this
  out requires a real zip → city/state reference dataset, which hasn't
  been wired in.
- Debris type (CnD / Mixed) can change which price shows for a vendor,
  including a state-suggested price for "Must Call For Pricing" vendors.
- "Franchised" and "DO NOT PRICE QUOTE" vendors never get a price —
  franchised means the job can't legally be taken there at all, and DNQ is
  a blacklist admin-only flag.

See the dated `CHANGES-*.md` files in this repo for a full history of what
changed and why, session by session.
