# Vendor Quote Tool

Plain HTML/CSS/JS site for quoting dumpster/roll-off jobs — no build step, drop straight into a GitHub Pages repo root.

## Files
- `index.html` — landing page (Sales / Admin)
- `sales.html`, `admin.html` — the two pages
- `css/styles.css` — all styling
- `js/data.js` — vendor data, generated from the Excel sheet (see below) — don't hand-edit
- `js/quote-engine.js` — location matching and pricing logic
- `js/sales.js`, `js/admin.js` — the two pages' controllers
- `tools/convert-vendor-sheet.py` — regenerates `js/data.js` from the Excel sheet

## Updating the data
When there's a new version of the sheet, run:

```
python3 tools/convert-vendor-sheet.py path/to/sheet.xlsx js/data.js
```

This is built against the current filler sheet's column layout (State, City,
Vendor, Phone, Pricing Model, Delivery, Haul Rate, Per Ton, Fuel Surcharge,
10/15/20/30/40 YD, Other, Other2). If the real Master Sheet ends up with a
different layout, this script is the one place that needs to change — nothing
else in the site does.
