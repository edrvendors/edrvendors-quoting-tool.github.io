/* =========================================================
   QUOTE ENGINE (v2)

   Key rules, confirmed with Dee:
   - Reps never enter tonnage — the site shows what each vendor offers.
   - Quoted tonnage always follows the standard convention by size
     (1T/10YD, 2T/20YD, 3T/30YD, 4T/40YD), even if a vendor's real data
     would allow more. That gap is unbilled overage headroom, not shown.
   - Rental period shown is whatever the vendor's data actually says —
     there's no equivalent fixed convention for days.
   - Markup order: (base price + vendor's delivery/fuel fees) -> tax ->
     ÷0.74 (COGS), in that order, COGS last.
   - Overage rates (per-ton, per-day) get tax + ÷0.74 too, but NOT the
     delivery/fuel fees (those are one-time container fees, not per-unit).
   - Haul + Disposal is the one model where a rep can flex tonnage; the
     price recalculates live from the same per-ton rate used for overage.
   - No cost/tax/margin breakdown is ever shown to a sales rep — just the
     final numbers.
   ========================================================= */

import {
  PRICING_RULES, ZIP_TO_LOCATION, STANDARD_TONS_BY_SIZE,
  MARGIN_DIVISOR,
} from './data.js';

const TIER_LABEL = { city: 'City match', state: 'State match', regional: 'Regional estimate' };
const TAX_RATE = 0; // placeholder — this filler sheet has no tax column yet

export function resolveZip(raw) {
  const zip = (raw || '').trim();
  if (!/^\d{5}$/.test(zip)) return null;
  return ZIP_TO_LOCATION[zip] || null;
}

/** city -> state -> regional. No county tier — the real sheet has no
 *  county data, so that tier from the earlier mock is dropped for now. */
function resolveTier(rows, { city, state }) {
  if (city) {
    const cityRows = state
      ? rows.filter(r => r.city?.toLowerCase() === city.toLowerCase() && r.state === state)
      : rows.filter(r => r.city?.toLowerCase() === city.toLowerCase());
    if (cityRows.length) return { tier: 'city', rows: cityRows };
  }
  if (state) {
    const stateRows = rows.filter(r => r.state === state);
    if (stateRows.length) return { tier: 'state', rows: stateRows };
  }
  return { tier: 'regional', rows: [] }; // no real "regional" pool without a state to anchor to
}

function includedTons(row) {
  if (row.pricingModel === 'flat') return null;
  return STANDARD_TONS_BY_SIZE[row.size] ?? row.rawTons ?? null;
}

function markup(amount, { withFees = 0 } = {}) {
  const afterFees = amount + withFees;
  const afterTax = afterFees * (1 + TAX_RATE);
  return afterTax / MARGIN_DIVISOR;
}

/** Computes the full customer-facing quote for one pricing rule.
 *  overrideTons lets the haul+disposal adjuster recalculate live. */
export function priceRule(row, overrideTons = null) {
  const fees = (row.delivery || 0) + (row.fuelSurcharge || 0);
  const tons = row.pricingModel === 'haul_plus_disposal'
    ? (overrideTons ?? STANDARD_TONS_BY_SIZE[row.size] ?? 1)
    : includedTons(row);

  let basePrice;
  if (row.pricingModel === 'haul_plus_disposal') {
    basePrice = (row.haulRate || 0) + (row.perTon || 0) * tons;
  } else {
    basePrice = row.price || 0;
  }

  const total = markup(basePrice, { withFees: fees });

  const tonOverageRaw = row.pricingModel === 'haul_plus_disposal' ? row.perTon : row.tonOverageRate;
  const tonOverage = tonOverageRaw != null ? markup(tonOverageRaw) : null;
  const dayOverage = row.dayOverageRate != null ? markup(row.dayOverageRate) : null;

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

function debrisMatches() {
  // This filler sheet has no per-vendor debris data yet, so nothing is
  // ever filtered out by debris type — matches Dee's rule that debris
  // type should never remove a vendor from the results.
  return true;
}

/** Admin search — direct substring/exact match on city, state, and/or
 *  vendor name, no location fallback logic (that's a sales-flow concept). */
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
    return { hasLocation: false, tier: null, tierLabel: '', results: [], note: '' };
  }

  const match = resolveTier(PRICING_RULES, location);
  let rows = match.rows;
  if (filters.size && filters.size !== 'any') {
    rows = rows.filter(r => String(r.size) === String(filters.size));
  }
  rows = rows.filter(debrisMatches);

  const results = rows.map(row => ({ row, price: priceRule(row) }));

  return {
    hasLocation: true,
    tier: match.tier,
    tierLabel: TIER_LABEL[match.tier],
    note,
    results,
  };
}

export function money(n) {
  if (n == null) return '\u2014';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
