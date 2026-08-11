/* =========================================================
   PLACEHOLDER DATA
   This file stands in for the real vendors.json /
   pricing-rules.json / tax-rules.json / debris-types.json
   that the GitHub Action will generate from the Master
   Vendor Sheet once it's finished.

   The shape here is deliberate — vendors, pricing rules,
   tax rules, and debris types as separate collections —
   so swapping in the real export later should mean
   replacing this file's contents, not rewriting the engine
   that reads it.
   ========================================================= */

export const VENDORS = [
  { id: 'v1', name: 'Cascade Roll-Off Co.' },
  { id: 'v2', name: 'Lone Star Waste Solutions' },
  { id: 'v3', name: 'Willamette Valley Disposal' },
  { id: 'v4', name: 'Big Sky Container Services' },
];

export const DEBRIS_TYPES = [
  { id: 'mixed', name: 'Mixed / General Debris' },
  { id: 'concrete', name: 'Concrete & Brick' },
  { id: 'yard', name: 'Yard Waste' },
  { id: 'junk', name: 'Household Junk' },
  { id: 'roofing', name: 'Roofing / Shingles' },
];

export const SIZES = [10, 20, 30, 40];

/* Lets the engine resolve a county for a city that has no
   city-level record of its own, without needing a full
   real geocoding dataset yet. Key = "city|ST" lowercase. */
export const CITY_COUNTY_MAP = {
  'portland|OR': 'Multnomah',
  'gresham|OR': 'Multnomah',
  'salem|OR': 'Marion',
  'austin|TX': 'Travis',
  'round rock|TX': 'Travis',
  'houston|TX': 'Harris',
};

/* tier: 'city' | 'county' | 'state' | 'regional'
   pricingModel: 'haul_plus_disposal' | 'flat' | 'standard'
   - haul_plus_disposal: haulCost + (perTonRate * tons)
   - flat / standard: flatRate, tonnage not required        */
export const PRICING_RULES = [
  // Portland, OR — city-level, haul + disposal, all sizes
  { id: 'p1', vendorId: 'v1', tier: 'city', city: 'Portland', county: 'Multnomah', state: 'OR', size: 10, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 260, perTonRate: 68 },
  { id: 'p2', vendorId: 'v1', tier: 'city', city: 'Portland', county: 'Multnomah', state: 'OR', size: 20, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 310, perTonRate: 68 },
  { id: 'p3', vendorId: 'v1', tier: 'city', city: 'Portland', county: 'Multnomah', state: 'OR', size: 30, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 365, perTonRate: 72 },
  { id: 'p4', vendorId: 'v1', tier: 'city', city: 'Portland', county: 'Multnomah', state: 'OR', size: 40, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 410, perTonRate: 72 },
  { id: 'p5', vendorId: 'v3', tier: 'city', city: 'Portland', county: 'Multnomah', state: 'OR', size: 20, debrisTypeIds: ['concrete'], pricingModel: 'haul_plus_disposal', haulCost: 295, perTonRate: 82 },

  // Multnomah County, OR — county-level (covers Gresham, no city record)
  { id: 'p6', vendorId: 'v1', tier: 'county', county: 'Multnomah', state: 'OR', size: 20, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 330, perTonRate: 70 },
  { id: 'p7', vendorId: 'v1', tier: 'county', county: 'Multnomah', state: 'OR', size: 30, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 385, perTonRate: 74 },

  // Oregon — state-level (covers Salem, no city/county record)
  { id: 'p8', vendorId: 'v3', tier: 'state', state: 'OR', size: 20, debrisTypeIds: 'all', pricingModel: 'standard', flatRate: 415 },
  { id: 'p9', vendorId: 'v3', tier: 'state', state: 'OR', size: 30, debrisTypeIds: 'all', pricingModel: 'standard', flatRate: 480 },

  // Austin, TX — city-level, flat rate
  { id: 'p10', vendorId: 'v2', tier: 'city', city: 'Austin', county: 'Travis', state: 'TX', size: 20, debrisTypeIds: 'all', pricingModel: 'flat', flatRate: 349 },
  { id: 'p11', vendorId: 'v2', tier: 'city', city: 'Austin', county: 'Travis', state: 'TX', size: 30, debrisTypeIds: 'all', pricingModel: 'flat', flatRate: 419 },

  // Travis County, TX — county-level (covers Round Rock)
  { id: 'p12', vendorId: 'v2', tier: 'county', county: 'Travis', state: 'TX', size: 20, debrisTypeIds: 'all', pricingModel: 'flat', flatRate: 379 },

  // Texas — state-level (covers Houston, no city/county record)
  { id: 'p13', vendorId: 'v2', tier: 'state', state: 'TX', size: 20, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 240, perTonRate: 58 },

  // Regional — last-resort fallback when nothing else matches
  { id: 'p14', vendorId: 'v4', tier: 'regional', size: 20, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 300, perTonRate: 70 },
  { id: 'p15', vendorId: 'v4', tier: 'regional', size: 30, debrisTypeIds: 'all', pricingModel: 'haul_plus_disposal', haulCost: 360, perTonRate: 74 },
];

export const TAX_RULES = [
  { tier: 'city', city: 'Portland', state: 'OR', rate: 0 },        // OR has no sales tax
  { tier: 'county', county: 'Travis', state: 'TX', rate: 0.0825 },
  { tier: 'state', state: 'OR', rate: 0 },
  { tier: 'state', state: 'TX', rate: 0.0625 },
  { tier: 'regional', rate: 0.07, notes: 'Placeholder average — confirm before quoting' },
];

/* Applied to the base cost (before add-ons/tax) whenever a
   quote is built from anything below 'city' tier — mirrors
   the $100 buffer used on the Master Vendor Sheet fallback. */
export const FALLBACK_BUFFER = 100;

/* Base ÷ margin denominator from the approved quoting formula. */
export const MARGIN_DIVISOR = 0.74;
