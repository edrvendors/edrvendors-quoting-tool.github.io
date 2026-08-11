# Vendor Quote Tool — bare-bones scaffold

Plain HTML/CSS/JS, no build step, ready to drop into a repo root for GitHub Pages.

## Structure

```
index.html        Landing page — Sales / Admin split
sales.html         Sales quote builder (customer-facing totals only)
admin.html         Admin quote builder (vendor, cost, model, tier detail)
css/styles.css      All styles — design tokens live at the top
js/data.js          PLACEHOLDER data — swap this out once the real JSON export exists
js/quote-engine.js  Location fallback (city → county → state → regional) + pricing math
js/sales.js         Sales page controller
js/admin.js         Admin page controller
```

## Testing locally

Because the pages use ES modules (`<script type="module">`), opening `index.html`
directly by double-clicking it won't work in most browsers — modules are blocked
over `file://` by CORS. Run a tiny local server from this folder instead:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`. This isn't an issue on GitHub Pages — it only
affects local double-click testing.

## Swapping in real data

`js/data.js` is the only file that should need replacing. Keep the same shape
(`VENDORS`, `DEBRIS_TYPES`, `PRICING_RULES`, `TAX_RULES`, `CITY_COUNTY_MAP`) and
everything else keeps working. If the GitHub Action ends up generating separate
JSON files instead of one `data.js`, `quote-engine.js` just needs its three
imports pointed at fetched JSON instead — the matching/pricing logic doesn't care
where the arrays came from.

## Decisions made without asking (flag anything you want changed)

- **Add-ons are itemized**, not combined — delivery, fuel, and overage are three
  separate optional dollar fields, added on top of the quote after the ÷0.74
  margin (matches "independent" in the pricing formula). Easy to collapse into
  one field later if you'd rather.
- **"Standard" pricing model is treated like "flat rate"** (single fixed cost,
  tonnage ignored) since I don't yet know how it should differ.
- **Zip code input isn't actually geocoded** — a 5-digit entry currently just
  falls back to the regional tier with a note. City/state text is what really
  drives the fallback chain right now. Real zip→city/county resolution needs
  either a zip database or your spreadsheet exporting a zip field directly.
- **Tax is applied to the quote total** (base + add-ons), not to the raw vendor
  cost. Worth confirming that's how it should actually work.
- The **$100 fallback buffer** is applied only when the match tier is below
  "city" (county/state/regional), shown as a price range rather than a single
  number — that's my read of "estimate, unconfirmed vendor," open to correction.

## Not built yet

- Real data (waiting on the finished spreadsheet + JSON export)
- Google Form link for requesting new vendors
- Any authentication — see the note about GitHub Pages + private repos from chat
