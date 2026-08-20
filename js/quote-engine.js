/* =========================================================
   QUOTE ENGINE (v3 — real Master Sheet)

   Key rules, confirmed with Dee:
   - Reps never enter tonnage — the site shows what each vendor offers.
   - Quoted tonnage always follows the standard convention by size
     (1T/10YD, 2T/20YD, 3T/30YD, 4T/40YD), even if a vendor's real data
     would allow more. That gap is unbilled overage headroom, not shown.
   - Rental period shown is whatever the vendor's data actually says —
     there's no equivalent fixed convention for days.
   - Markup order: (base price + vendor's delivery/fuel fees + 3.5% credit
     card processing fee on that subtotal) -> tax -> ÷0.74 (COGS), in that
     order, COGS last. The card fee applies no matter the pricing model or
     debris type — every dollar billed by a vendor gets it. Tax is now a
     real per-vendor rate straight from the sheet, not a placeholder.
   - A vendor's Fuel Surcharge can be a flat dollar fee, a percentage, or
     both. A percentage fee is computed against the container's base
     price only (haul + tonnage / rental price) — never delivery or other
     flat fees — per Dee's decision.
   - Overage rates (per-ton, per-day) get the same tax + card-fee + ÷0.74
     treatment as the base price, but NOT the delivery/fuel fees (those
     are one-time container fees, not per-unit).
   - Haul + Disposal is the one model where a rep can flex tonnage; the
     price recalculates live from the same per-ton rate used for overage.
   - Debris type ("cnd" / "mixed" / null-for-any) can split a single
     vendor+size into multiple priced variants (different Pricing Model
     rows, or a CnD Waste/Mixed Waste ton-rate override on an otherwise
     generic row). A generic (null) variant always matches any debris
     selection. When no debris type is selected, variants for the same
     vendor+city+size are grouped into one card with each price line
     labeled by debris type, instead of showing as separate, confusingly
     similar cards.
   - No cost/tax/margin breakdown is ever shown to a sales rep — just the
     final numbers.
   - Three pricing models never produce a price: "must_call_for_pricing"
     (vendor exists but needs a direct call — treated like "no priced
     vendor" for match-tier purposes, but still surfaced boldly since a
     real vendor contact is worth knowing), "franchised" (the city can't
     be serviced at all — bold "can't help" notice), and
     "do_not_price_quote" (a blacklisted vendor — hidden from sales
     entirely, visible to admin only as a warning).
   - A row with no Pricing Model at all was dropped during data
     conversion — never reaches this engine, same as no vendor existing.
   ========================================================= */

import {
  PRICING_RULES, ZIP_TO_LOCATION, STANDARD_TONS_BY_SIZE,
  MARGIN_DIVISOR, CC_FEE_RATE,
} from './data.js';

const TIER_LABEL = { city: 'City match', state: 'State match', regional: 'Regional estimate' };

const PRICEABLE_MODELS = new Set(['standard', 'flat', 'haul_plus_disposal']);
// Shown as a bold notice on sales results when they occur in the exact
// searched city. "do_not_price_quote" is deliberately NOT in this set —
// sales never sees it at all, only admin does.
const NOTICE_MODELS = new Set(['must_call_for_pricing', 'franchised']);

// Debris ids that actual vendor data distinguishes today. Any other
// selection (concrete/shingles/yard/any/blank) behaves like "show
// everything" — nothing in the sheet differentiates those yet.
const DATA_BACKED_DEBRIS = new Set(['cnd', 'mixed']);

export function resolveZip(raw) {
  const zip = (raw || '').trim();
  if (!/^\d{5}$/.test(zip)) return null;
  return ZIP_TO_LOCATION[zip] || null;
}

/** city -> state -> regional, counting ONLY priceable rows toward a match —
 *  a city with nothing but a "must call" or "franchised" row is treated
 *  the same as a city with no vendor at all, for fallback purposes. No
 *  county tier — the real sheet has no county data, so that tier from the
 *  earlier mock is dropped for now. */
function resolveTier(priceableRows, { city, state }) {
  if (city) {
    const cityRows = state
      ? priceableRows.filter(r => r.city?.toLowerCase() === city.toLowerCase() && r.state === state)
      : priceableRows.filter(r => r.city?.toLowerCase() === city.toLowerCase());
    if (cityRows.length) return { tier: 'city', rows: cityRows };
  }
  if (state) {
    const stateRows = priceableRows.filter(r => r.state === state);
    if (stateRows.length) return { tier: 'state', rows: stateRows };
  }
  return { tier: 'regional', rows: [] }; // no real "regional" pool without a state to anchor to
}

function includedTons(row) {
  if (row.pricingModel === 'flat') return null;
  return STANDARD_TONS_BY_SIZE[row.size] ?? row.rawTons ?? null;
}

/** basePrice is what a percentage fuel surcharge is computed against.
 *  includeFees=false is used for overage rates, which skip delivery/fuel
 *  fees entirely but still get the card fee, tax, and margin divisor. */
function markup(basePrice, row, includeFees) {
  let fees = 0;
  if (includeFees) {
    const fuelPercentFee = (row.fuelSurchargePercent || 0) * basePrice;
    fees = (row.delivery || 0) + (row.fuelSurchargeFlat || 0) + fuelPercentFee;
  }
  const subtotal = basePrice + fees;
  const ccFee = subtotal * CC_FEE_RATE;
  const afterCcFee = subtotal + ccFee;
  const afterTax = afterCcFee * (1 + (row.taxRate || 0));
  return afterTax / MARGIN_DIVISOR;
}

/** Computes the full customer-facing quote for one pricing rule.
 *  overrideTons lets the haul+disposal adjuster recalculate live.
 *  Returns { noticeModel } instead of a price for the three models that
 *  don't have a real quote to compute. */
export function priceRule(row, overrideTons = null) {
  if (!PRICEABLE_MODELS.has(row.pricingModel)) {
    return {
      tons: null, rentalDays: null, total: null,
      tonOverage: null, dayOverage: null,
      isFlat: false, isHaulPlusDisposal: false,
      noticeModel: row.pricingModel,
    };
  }

  const tons = row.pricingModel === 'haul_plus_disposal'
    ? (overrideTons ?? STANDARD_TONS_BY_SIZE[row.size] ?? 1)
    : includedTons(row);

  let basePrice;
  if (row.pricingModel === 'haul_plus_disposal') {
    basePrice = (row.haulRate || 0) + (row.perTon || 0) * tons;
  } else {
    basePrice = row.price || 0;
  }

  const total = markup(basePrice, row, true);

  const tonOverageRaw = row.pricingModel === 'haul_plus_disposal' ? row.perTon : row.tonOverageRate;
  const tonOverage = tonOverageRaw != null ? markup(tonOverageRaw, row, false) : null;
  const dayOverage = row.dayOverageRate != null ? markup(row.dayOverageRate, row, false) : null;

  return {
    tons,
    rentalDays: row.rentalDays,
    total,
    tonOverage,
    dayOverage,
    isFlat: row.pricingModel === 'flat',
    isHaulPlusDisposal: row.pricingModel === 'haul_plus_disposal',
  };
}

/** No debris selected (or a type the data doesn't back yet) -- show
 *  everything, grouped for distinction. A data-backed selection ('cnd' /
 *  'mixed') keeps exact matches, PLUS generic (debrisType null) rows only
 *  for vendor+size groups that have no specific match at all -- once a
 *  vendor has a real cnd-specific price, its generic fallback price
 *  would just be a confusing, less-accurate second number for that same
 *  debris type, so it's dropped rather than shown alongside. */
function filterByDebris(rows, debrisId) {
  if (!debrisId || !DATA_BACKED_DEBRIS.has(debrisId)) return rows;
  const groupKey = r => [r.vendor, r.city, r.state, r.size].join('|');
  const hasSpecificMatch = new Set(
    rows.filter(r => r.debrisType === debrisId).map(groupKey)
  );
  return rows.filter(r => {
    if (r.debrisType === debrisId) return true;
    if (r.debrisType != null) return false; // a different specific type
    return !hasSpecificMatch.has(groupKey(r)); // generic -- only if no specific match exists
  });
}

/** Groups same vendor+city+state+size rows into one card when more than
 *  one debris variant exists, so the sales rep sees one vendor entry with
 *  labeled price lines instead of confusingly similar duplicate cards. */
function groupForDisplay(items) {
  const order = [];
  const groups = new Map();
  for (const item of items) {
    const key = [item.row.vendor, item.row.city, item.row.state, item.row.size].join('|');
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(item);
  }
  return order.map(key => {
    const variants = groups.get(key);
    return variants.length > 1 ? { variants } : { single: variants[0] };
  });
}

/** Admin search — direct substring/exact match on city, state, and/or
 *  vendor name, no location fallback logic (that's a sales-flow concept).
 *  Never grouped — admin wants every raw row visible, debris variants
 *  included. */
export function searchAdmin({ cityRaw, stateRaw, vendorRaw }) {
  const city = (cityRaw || '').trim().toLowerCase();
  const state = (stateRaw || '').trim().toUpperCase();
  const vendor = (vendorRaw || '').trim().toLowerCase();
  if (!city && !state && !vendor) return [];
  return PRICING_RULES
    .filter(r => (!city || r.city?.toLowerCase().includes(city)) &&
                 (!state || r.state === state) &&
                 (!vendor || r.vendor?.toLowerCase().includes(vendor)))
    .map(row => ({ row, price: priceRule(row) }));
}

/** filters = { zipRaw, cityRaw, stateRaw, size, debrisId } */
export function getQuotes(filters) {
  const zipEntered = (filters.zipRaw || '').trim();
  const cityState = { city: (filters.cityRaw || '').trim(), state: (filters.stateRaw || '').trim().toUpperCase() };
  const hasCityState = !!(cityState.city || cityState.state);

  let location = cityState;
  let note = '';

  if (!hasCityState && zipEntered) {
    const resolved = resolveZip(zipEntered);
    if (resolved) {
      location = resolved;
    } else {
      note = `Zip ${zipEntered} isn\u2019t in this sample data yet \u2014 try a city and state instead.`;
    }
  }

  const hasLocation = hasCityState || !!zipEntered;
  if (!hasLocation) {
    return { hasLocation: false, tier: null, tierLabel: '', results: [], note: '', cityNotices: [] };
  }

  // Must-call / franchised notices for the EXACT searched city — shown
  // regardless of whether a priced vendor also exists there, and never
  // subject to the state/regional fallback (they're tied to that one city).
  const cityNotices = (location.city && location.state)
    ? PRICING_RULES.filter(r =>
        r.city?.toLowerCase() === location.city.toLowerCase() &&
        r.state === location.state &&
        NOTICE_MODELS.has(r.pricingModel))
    : [];

  const priceableRows = PRICING_RULES.filter(r => PRICEABLE_MODELS.has(r.pricingModel));
  const match = resolveTier(priceableRows, location);
  let rows = match.rows;
  if (filters.size && filters.size !== 'any') {
    rows = rows.filter(r => String(r.size) === String(filters.size));
  }
  rows = filterByDebris(rows, filters.debrisId);

  const items = rows.map(row => ({ row, price: priceRule(row) }));
  const results = groupForDisplay(items);

  return {
    hasLocation: true,
    tier: match.tier,
    tierLabel: TIER_LABEL[match.tier],
    note,
    results,
    cityNotices,
  };
}

export function money(n) {
  if (n == null) return '\u2014';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
