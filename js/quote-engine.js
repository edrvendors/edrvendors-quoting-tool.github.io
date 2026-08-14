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

   Suggested price (no-coverage estimate), confirmed with Dee:
   - "Covered" means a real vendor is on file at the entered zip or city.
     If covered: requested size on file -> show it (real price). Requested
     size NOT on file -> show a disclaimer plus real pricing for whatever
     sizes that vendor DOES offer. Never an estimate in either case.
   - "Not covered" means zip AND city both come up with zero vendors on
     file, regardless of size. That's when the state-average estimate
     kicks in — irrespective of which size was asked for.
   - There's no more "show some real vendor from a random city elsewhere
     in the state" tier — a state-wide vendor with no connection to the
     requested area was replaced by the estimate.
   - The estimate is a straight average of Standard-model vendors in the
     same state, computed separately per size tier (10/20/30/40 YD — no
     estimate for 15 YD, since there's no standard-tons convention for it).
   - Base price, ton-overage rate, and day-overage rate are each averaged,
     then bumped 15% ("aim high" — Dee would rather overquote slightly than
     risk a loss), then get the same tax + ÷0.74 COGS treatment as a real
     quote. No vendor delivery/fuel fees are added — there's no vendor to
     attach them to.
   - Rental period is a flat 7 Days for every estimate (Dee's call — unlike
     tonnage, rental days have no per-size convention to average against).
   - Tax uses the highest listed rate among that state's vendors. No
     taxRate column exists yet, so this quietly falls back to the same
     TAX_RATE placeholder every other quote uses until it's wired in.
   - Sales sees a single number and no breakdown — same as a real quote —
     but the result is visually flagged as an estimate.
   - Never shown in Admin search — searchAdmin() doesn't call any of this.
   ========================================================= */

import {
  PRICING_RULES, STANDARD_TONS_BY_SIZE,
  MARGIN_DIVISOR,
} from './data.js';

const TIER_LABEL = {
  zip: 'Exact match',
  city: 'City match',
  suggested: 'Estimated price — no vendor on file',
};
const TAX_RATE = 0; // placeholder — this filler sheet has no tax column yet

const STANDARD_SIZES = [10, 20, 30, 40]; // sizes the suggested-price estimate covers
const SUGGESTED_MARGIN = 1.15;           // 15% above the straight state average
const SUGGESTED_RENTAL_DAYS = 7;         // flat base, confirmed with Dee

function includedTons(row) {
  if (row.pricingModel === 'flat') return null;
  return STANDARD_TONS_BY_SIZE[row.size] ?? row.rawTons ?? null;
}

function markup(amount, { withFees = 0, taxRate = TAX_RATE } = {}) {
  if (amount == null) return null;
  const afterFees = amount + withFees;
  const afterTax = afterFees * (1 + taxRate);
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
  const tonOverage = markup(tonOverageRaw);
  const dayOverage = markup(row.dayOverageRate);

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

function bySize(rows, size) {
  if (!size || size === 'any') return rows.filter(debrisMatches);
  return rows.filter(r => String(r.size) === String(size)).filter(debrisMatches);
}

function average(nums) {
  const vals = nums.filter(n => n != null && !Number.isNaN(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Highest listed tax rate among a state's vendors. No taxRate column
 *  exists yet, so this quietly falls back to the same TAX_RATE placeholder
 *  every other quote uses — nothing else needs to change once the Sales
 *  Tax Rate column is wired in from the Master Sheet. */
function stateMaxTaxRate(state) {
  const rates = PRICING_RULES
    .filter(r => r.state === state && r.taxRate != null)
    .map(r => r.taxRate);
  return rates.length ? Math.max(...rates) : TAX_RATE;
}

/** State-average estimate, one entry per standard size tier (or just the
 *  requested one). Only draws from Standard-model rows — Flat and
 *  Haul+Disposal don't price the same way, so they're never blended in. */
function buildSuggestedPrices(state, requestedSize) {
  const requestedNum = Number(requestedSize);
  const sizesToTry = (requestedSize && requestedSize !== 'any')
    ? (STANDARD_SIZES.includes(requestedNum) ? [requestedNum] : [])
    : STANDARD_SIZES;

  const taxRate = stateMaxTaxRate(state);
  const out = [];

  for (const size of sizesToTry) {
    const pool = PRICING_RULES.filter(r =>
      r.state === state && r.pricingModel === 'standard' && r.size === size);

    const avgPrice = average(pool.map(r => r.price));
    if (avgPrice == null) continue; // no Standard data for this tier in this state

    const avgTonOverage = average(pool.map(r => r.tonOverageRate));
    const avgDayOverage = average(pool.map(r => r.dayOverageRate));
    const boosted = (n) => n == null ? null : markup(n * SUGGESTED_MARGIN, { taxRate });

    out.push({
      size,
      tons: STANDARD_TONS_BY_SIZE[size] ?? null,
      rentalDays: SUGGESTED_RENTAL_DAYS,
      total: boosted(avgPrice),
      tonOverage: boosted(avgTonOverage),
      dayOverage: boosted(avgDayOverage),
    });
  }
  return out;
}

/** Finds any real vendor rows on file at the entered zip or city, in that
 *  order, regardless of size — this determines whether the location is
 *  "covered" at all. Returns null if neither has any vendor on file. */
function findCoveredLocation(zipEntered, cityState) {
  if (/^\d{5}$/.test(zipEntered)) {
    const rows = PRICING_RULES.filter(r => r.zip === zipEntered);
    if (rows.length) return { tier: 'zip', rows };
  }
  if (cityState.city) {
    const rows = cityState.state
      ? PRICING_RULES.filter(r => r.city?.toLowerCase() === cityState.city.toLowerCase() && r.state === cityState.state)
      : PRICING_RULES.filter(r => r.city?.toLowerCase() === cityState.city.toLowerCase());
    if (rows.length) return { tier: 'city', rows };
  }
  return null;
}

/** Admin search — direct substring/exact match on city, state, and/or
 *  vendor name. No location fallback and no suggested-price estimate —
 *  that's a sales-flow-only concept and never appears here. */
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
  const cityState = {
    city: (filters.cityRaw || '').trim(),
    state: (filters.stateRaw || '').trim().toUpperCase(),
  };
  const hasLocation = !!(cityState.city || cityState.state || zipEntered);

  const empty = {
    hasLocation, tier: null, tierLabel: '', note: '',
    sizeUnavailable: false, results: [], suggested: [],
    addVendorPrompt: false, addVendorContext: null,
  };

  if (!hasLocation) return empty;

  const asResults = rows => rows.map(row => ({ row, price: priceRule(row) }));
  const covered = findCoveredLocation(zipEntered, cityState);

  if (covered) {
    // A real vendor is on file here. If they offer the requested size,
    // show it. If not, say so plainly and show what they DO offer —
    // never an estimate once a real vendor is already on file locally.
    const sizeMatched = bySize(covered.rows, filters.size);
    if (sizeMatched.length) {
      return { ...empty, tier: covered.tier, tierLabel: TIER_LABEL[covered.tier], results: asResults(sizeMatched) };
    }
    const anySize = covered.rows.filter(debrisMatches);
    const sample = covered.rows[0];
    const areaLabel = sample ? `${sample.city}, ${sample.state}` : [cityState.city, cityState.state].filter(Boolean).join(', ');
    return {
      ...empty,
      tier: covered.tier,
      tierLabel: TIER_LABEL[covered.tier],
      sizeUnavailable: true,
      note: `${filters.size} yd isn\u2019t available from vendors on file in ${areaLabel} \u2014 here\u2019s what they do offer instead:`,
      results: asResults(anySize),
    };
  }

  // Neither zip nor city has a vendor on file — the location itself isn't
  // covered. Pull the state-average estimate, regardless of requested size.
  const state = cityState.state;
  const suggested = state ? buildSuggestedPrices(state, filters.size) : [];

  return {
    ...empty,
    tier: suggested.length ? 'suggested' : null,
    tierLabel: suggested.length ? TIER_LABEL.suggested : '',
    note: state ? '' : 'Add a state (or a matching zip/city) to check coverage for this area.',
    suggested,
    addVendorPrompt: true,
    addVendorContext: { city: cityState.city, state, zip: zipEntered },
  };
}

export function money(n) {
  if (n == null) return '\u2014';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
