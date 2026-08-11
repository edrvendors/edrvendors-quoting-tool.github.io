/* =========================================================
   QUOTE ENGINE
   Location fallback (city -> county -> state -> regional),
   pricing-model math, and the Cost / 0.74 quoting formula.
   Kept framework-free so it works the same against this
   placeholder data or the real generated JSON later.
   ========================================================= */

import {
  PRICING_RULES, TAX_RULES, CITY_COUNTY_MAP,
  FALLBACK_BUFFER, MARGIN_DIVISOR,
} from './data.js';

const TIER_ORDER = ['city', 'county', 'state', 'regional'];
const TIER_LABEL = { city: 'City', county: 'County', state: 'State', regional: 'Regional (unconfirmed)' };

/** Best-effort split of free-text "City, ST" or a zip into parts.
 *  Zip-to-location resolution isn't wired up yet — see note in resolveLocation(). */
export function parseLocation(raw) {
  const value = (raw || '').trim();
  if (!value) return { city: '', state: '', zip: '' };

  if (/^\d{5}$/.test(value)) return { city: '', state: '', zip: value };

  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], state: parts[1].toUpperCase().slice(0, 2), zip: '' };
  }
  return { city: parts[0] || '', state: '', zip: '' };
}

function cityCounty(city, state) {
  if (!city || !state) return '';
  return CITY_COUNTY_MAP[`${city.toLowerCase()}|${state.toUpperCase()}`] || '';
}

/** Walks city -> county -> state -> regional and returns the first
 *  tier with any matching rows, plus which tier it landed on. */
function resolveTier(rows, location) {
  const { city, state, zip } = location;

  if (zip && !city && !state) {
    // No real zip database wired up yet — regional is the honest answer for now.
    const regional = rows.filter(r => r.tier === 'regional');
    return { tier: 'regional', rows: regional, note: 'Zip lookup isn\u2019t wired to real geography yet — showing the regional fallback.' };
  }

  if (city && state) {
    const cityRows = rows.filter(r => r.tier === 'city' && r.city?.toLowerCase() === city.toLowerCase() && r.state === state);
    if (cityRows.length) return { tier: 'city', rows: cityRows };

    const county = cityCounty(city, state);
    if (county) {
      const countyRows = rows.filter(r => r.tier === 'county' && r.county === county && r.state === state);
      if (countyRows.length) return { tier: 'county', rows: countyRows };
    }
  }

  if (state) {
    const stateRows = rows.filter(r => r.tier === 'state' && r.state === state);
    if (stateRows.length) return { tier: 'state', rows: stateRows };
  }

  const regional = rows.filter(r => r.tier === 'regional');
  return { tier: 'regional', rows: regional };
}

function debrisMatches(rowDebris, wantedId) {
  if (!wantedId || wantedId === 'any') return true;
  if (rowDebris === 'all') return true;
  return Array.isArray(rowDebris) && rowDebris.includes(wantedId);
}

/** Computes cost, quote, add-ons, tax, and total for one pricing row.
 *  addons = { delivery, fuel, overage } — each optional, in dollars. */
function priceRow(row, { tons, addons, taxRate }) {
  let cost = null;
  let costNote = '';

  if (row.pricingModel === 'haul_plus_disposal') {
    if (tons > 0) {
      cost = row.haulCost + row.perTonRate * tons;
    } else {
      cost = row.haulCost;
      costNote = 'Haul cost only — enter tonnage for the disposal charge.';
    }
  } else {
    cost = row.flatRate;
  }

  const isEstimate = row.tier !== 'city';
  const costHigh = isEstimate ? cost + FALLBACK_BUFFER : cost;

  const addonsTotal = (addons.delivery || 0) + (addons.fuel || 0) + (addons.overage || 0);

  const quote = cost / MARGIN_DIVISOR + addonsTotal;
  const quoteHigh = costHigh / MARGIN_DIVISOR + addonsTotal;

  const tax = quote * (taxRate || 0);
  const taxHigh = quoteHigh * (taxRate || 0);

  return {
    cost, costHigh, costNote,
    addonsTotal,
    quote, quoteHigh,
    tax, taxHigh,
    total: quote + tax,
    totalHigh: quoteHigh + taxHigh,
    isEstimate,
  };
}

/** Main entry point used by both sales.js and admin.js.
 *  filters = { locationRaw, size, debrisId, tons, addons } */
export function getQuotes(filters) {
  const location = parseLocation(filters.locationRaw);
  const hasLocation = !!(location.city || location.state || location.zip);

  if (!hasLocation) {
    return { hasLocation: false, tier: null, tierLabel: '', results: [], note: '' };
  }

  const priceMatch = resolveTier(PRICING_RULES, location);
  const taxMatch = resolveTier(TAX_RULES, location);
  const taxRate = taxMatch.rows[0]?.rate ?? 0;

  let rows = priceMatch.rows;
  if (filters.size && filters.size !== 'any') {
    rows = rows.filter(r => String(r.size) === String(filters.size));
  }
  rows = rows.filter(r => debrisMatches(r.debrisTypeIds, filters.debrisId));

  const results = rows.map(row => ({
    row,
    price: priceRow(row, { tons: filters.tons, addons: filters.addons, taxRate }),
  }));

  return {
    hasLocation: true,
    tier: priceMatch.tier,
    tierLabel: TIER_LABEL[priceMatch.tier],
    note: priceMatch.note || '',
    results,
    taxRate,
  };
}

export function vendorName(vendorId, vendors) {
  return vendors.find(v => v.id === vendorId)?.name || 'Unknown vendor';
}

export function debrisNames(ids, debrisTypes) {
  if (ids === 'all') return 'All debris types';
  return ids.map(id => debrisTypes.find(d => d.id === id)?.name || id).join(', ');
}

export function money(n) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
