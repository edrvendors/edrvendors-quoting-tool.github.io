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
   - Three pricing models never produce a *confirmed* price: "must_call_for_pricing"
     shows a suggested quote instead — computed the exact same way as the
     no-vendor-in-this-city estimate (state-average of real Standard rows
     for that size, +15%, taxed at the state's highest rate, ÷0.74) — so a
     rep has a number to quote immediately, with a clear note that it's an
     estimate and the vendor needs an actual call before the job is
     invoiced. "franchised" (the city can't be serviced at all — bold
     "can't help" notice, never a price, since quoting a job we're
     contractually unable to take would be actively wrong) and
     "do_not_price_quote" (a blacklisted vendor — hidden from sales
     entirely, visible to admin only as a warning) still never show a
     number. A single size within an otherwise-priceable Haul + Disposal
     vendor can also carry its own must-call notice (an "Available — call
     for pricing" cell) — same estimate treatment, scoped to just that size.
   - A row with no Pricing Model at all was dropped during data
     conversion — never reaches this engine, same as no vendor existing.
   - When there's no priced vendor in the exact searched city, the site
     does NOT fall back to showing real vendor prices from elsewhere in
     the state — that would misrepresent another city's actual vendor as
     if they were local. Instead it shows a computed state-average
     ESTIMATE per size (Standard-model rows in that state only, averaged,
     bumped 15%, taxed at the state's highest listed rate, ÷0.74, flat
     7-day rental) clearly labeled as an estimate, plus — separately, with
     no price attached — the name and phone number of a vendor in that
     state worth calling to check if they'll actually service the area.
   ========================================================= */

import {
  PRICING_RULES, ZIP_TO_LOCATION, STANDARD_TONS_BY_SIZE,
  MARGIN_DIVISOR, CC_FEE_RATE, ESTIMATE_BUMP, ESTIMATE_RENTAL_DAYS, SIZES,
} from './data.js';

const PRICEABLE_MODELS = new Set(['standard', 'flat', 'haul_plus_disposal']);
// Shown as a bold notice on sales results when they occur in the exact
// searched city. "do_not_price_quote" is deliberately NOT in this set —
// sales never sees it at all, only admin does.
const NOTICE_MODELS = new Set(['must_call_for_pricing', 'franchised']);

// Debris ids that actual vendor data distinguishes today. Any other
// selection (any/blank) behaves like "show everything".
const DATA_BACKED_DEBRIS = new Set(['cnd', 'mixed']);

export function resolveZip(raw) {
  const zip = (raw || '').trim();
  if (!/^\d{5}$/.test(zip)) return null;
  return ZIP_TO_LOCATION[zip] || null;
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

/** City notices (must-call / franchised, including a single Haul +
 *  Disposal size that's must-call on its own) for the EXACT searched
 *  city. City-only matching works the same as priced results — state is
 *  used to disambiguate same-named cities in different states when
 *  given, but isn't required. Filtered to the selected size (if any) and
 *  deduplicated by vendor so a vendor offering four must-call sizes
 *  doesn't produce four banners when the rep hasn't narrowed by size. */
/** Same city-matching rule as priced results — state disambiguates when
 *  given, isn't required. Franchised notices are deduped one per vendor
 *  (no price ever applies, so repeating per size adds nothing). Must-call
 *  notices are deduped per vendor+size instead, since each size now
 *  carries its own suggested price below. */
function findCityNotices(city, state, size) {
  if (!city) return [];
  let rows = state
    ? PRICING_RULES.filter(r => r.city?.toLowerCase() === city.toLowerCase() && r.state === state)
    : PRICING_RULES.filter(r => r.city?.toLowerCase() === city.toLowerCase());
  rows = rows.filter(r => NOTICE_MODELS.has(r.pricingModel));
  if (size && size !== 'any') {
    rows = rows.filter(r => String(r.size) === String(size));
  }
  const seen = new Set();
  const deduped = rows.filter(r => {
    const key = r.pricingModel === 'franchised'
      ? r.vendor + '|' + r.pricingModel
      : r.vendor + '|' + r.pricingModel + '|' + r.size;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.map(r => ({
    ...r,
    estimate: r.pricingModel === 'must_call_for_pricing' ? estimateForSize(r.state, r.size) : null,
  }));
}

/** Standard-model rows in a state, one per unique vendor+city+size so a
 *  vendor with multiple debris variants isn't weighted more than once. */
function standardRowsForState(state) {
  const seen = new Set();
  return PRICING_RULES.filter(r => {
    if (r.state !== state || r.pricingModel !== 'standard') return false;
    const key = [r.vendor, r.city, r.size].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One size's state-average estimate: average of real Standard-model base
 *  prices in that state for that size, bumped 15%, taxed at the state's
 *  highest listed rate, ÷0.74. No card fee (this isn't a real vendor
 *  transaction) and a flat 7-day rental, since there's no real vendor
 *  data to draw a rental period from. Returns null if the state has no
 *  Standard rows for that size -- no data to average means no estimate,
 *  rather than a guess. Backs both the "no vendor in this city at all"
 *  fallback and the suggested price shown alongside a "must call for
 *  pricing" vendor -- same algorithm either way, per Dee's call. */
function estimateForSize(state, size) {
  const sizeRows = standardRowsForState(state).filter(r => r.size === size && r.price != null);
  if (!sizeRows.length) return null;
  const highestTax = Math.max(...PRICING_RULES.filter(r => r.state === state).map(r => r.taxRate || 0));
  const avg = sizeRows.reduce((sum, r) => sum + r.price, 0) / sizeRows.length;
  const bumped = avg * ESTIMATE_BUMP;
  const total = (bumped * (1 + highestTax)) / MARGIN_DIVISOR;
  return { size, total, rentalDays: ESTIMATE_RENTAL_DAYS, sampleSize: sizeRows.length };
}

function stateEstimates(state) {
  return SIZES.map(size => estimateForSize(state, size)).filter(Boolean);
}

/** Best-effort "someone to call and check" suggestion -- name and phone
 *  only, never a price. There's no zip/lat-long geocoding wired in yet,
 *  so "nearby" is necessarily approximate: any vendor in the same state
 *  with a phone number on file, not a true distance calculation. */
function vendorsToCall(state, size) {
  const seen = new Set();
  const candidates = PRICING_RULES.filter(r => {
    if (r.state !== state || !r.phone || seen.has(r.vendor)) return false;
    if (size && size !== 'any' && r.size !== Number(size)) return false;
    seen.add(r.vendor);
    return true;
  });
  return candidates.slice(0, 2).map(r => ({ vendor: r.vendor, phone: r.phone, city: r.city }));
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
    return { hasLocation: false, tier: null, results: [], note: '', cityNotices: [], estimates: [], callVendors: [] };
  }

  const cityNotices = findCityNotices(location.city, location.state, filters.size);

  const priceableRows = PRICING_RULES.filter(r => PRICEABLE_MODELS.has(r.pricingModel));
  let cityRows = location.city
    ? (location.state
        ? priceableRows.filter(r => r.city?.toLowerCase() === location.city.toLowerCase() && r.state === location.state)
        : priceableRows.filter(r => r.city?.toLowerCase() === location.city.toLowerCase()))
    : [];

  if (filters.size && filters.size !== 'any') {
    cityRows = cityRows.filter(r => String(r.size) === String(filters.size));
  }
  cityRows = filterByDebris(cityRows, filters.debrisId);

  if (cityRows.length) {
    const items = cityRows.map(row => ({ row, price: priceRule(row) }));
    return {
      hasLocation: true, tier: 'city', note,
      results: groupForDisplay(items), cityNotices, estimates: [], callVendors: [],
    };
  }

  // A "must call for pricing" vendor already carries its own suggested
  // quote and its own name/number to call -- showing the generic
  // faceless state estimate and "someone to call" block underneath it
  // would just repeat the same number and suggest a second, vaguer
  // vendor to call instead of the specific one already on screen.
  const hasMustCallNotice = cityNotices.some(n => n.pricingModel === 'must_call_for_pricing');
  if (hasMustCallNotice) {
    return { hasLocation: true, tier: 'city', note, results: [], cityNotices, estimates: [], callVendors: [] };
  }

  // No priced vendor in the exact city -- a state-average estimate, not
  // another city's real vendor prices standing in for this one.
  if (!location.state) {
    return { hasLocation: true, tier: 'none', note, results: [], cityNotices, estimates: [], callVendors: [] };
  }
  let estimates = stateEstimates(location.state);
  if (filters.size && filters.size !== 'any') {
    estimates = estimates.filter(e => String(e.size) === String(filters.size));
  }
  const callVendors = vendorsToCall(location.state, filters.size);

  return {
    hasLocation: true,
    tier: 'estimate',
    note,
    results: [],
    cityNotices,
    estimates,
    callVendors,
  };
}

export function money(n) {
  if (n == null) return '\u2014';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
