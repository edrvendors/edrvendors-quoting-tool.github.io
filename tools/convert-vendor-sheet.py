"""
Converts the Master Vendor Sheet into js/data.js for the quote site.

Usage:
    python3 convert-vendor-sheet.py <path-to-xlsx> <output-path-for-data.js>

Built against the real Master Vendor Sheet (post-cleanup) column layout:
    State, City, 10 yard, 15 yard, 20 yard, 30 yard, 40 yd, Pricing Model,
    Haul Rate, Tonnage Rate, CnD Waste, Mixed Waste, Fuel Surcharge, Other,
    Delivery, Vendor, Phone, Zipcodes by City, Sales Tax Rate

Rules applied (confirmed with Dee):
  - An empty or "N/A"-style size cell means the vendor does not offer that
    size at all.
  - A blank/missing Pricing Model means there is no real vendor for that
    row -- it's dropped entirely, same as if the row didn't exist.
  - Debris type ("cnd" / "mixed" / null-for-any) comes from two sources,
    treated with the same logic:
      1. The Pricing Model name itself: "Standard Mixed"/"Flat Rate
         Residential" -> mixed; "Standard CnD"/"Flat Rate CnD" -> cnd.
      2. The CnD Waste / Mixed Waste columns on an otherwise generic
         Standard or Haul + Disposal row -- when either is populated, the
         row is split into a debris-tagged sibling (using that column's
         ton rate) *plus* the original generic row stays as the fallback
         for any other debris type.
    On the sales site, a debris-tagged rule only shows when that debris
    type is selected (or nothing is selected, where it's shown alongside
    its siblings with a badge). A generic (debrisType null) rule always
    shows regardless of what's selected.
  - "Haul + Disposal Commercial - See container size for price" is the
    same haul_plus_disposal model, except the haul rate is per-size
    (parsed from each size cell's "$X Per Haul" text) instead of a single
    shared Haul Rate. The shared Tonnage Rate column still applies to
    every size.
  - The "Other" column can carry a per-ton rate, a per-day rate, or both
    in the same cell -- both are extracted independently.
  - Fuel Surcharge is either a flat dollar amount or a percentage
    ("X% of total bill" / "X% of total haul + disposal" / etc). Per
    Dee's decision, any percentage form is applied against the
    container's base price only (haul + tonnage / rental price), not
    delivery or other flat fees, and all percentage phrasings are
    treated identically. A row can carry both (e.g. "$25 + 20% on
    disposal costs").
  - Sales Tax Rate is now a clean decimal fraction on every row already
    (cleanup script's job) -- passed straight through.
  - A "(12YD)" prefix on a size cell means the vendor's real container is
    a different size than the column position implies. Column position
    is still trusted as the sales-facing size, per Dee's original
    instruction -- the real size is kept as an admin-only note.
"""
import sys
import re
import os
import json
import math
import pandas as pd
from collections import Counter, defaultdict
import zipcodes

SIZE_COLUMNS = ['10 yard', '15 yard', '20 yard', '30 yard', '40 yd']
SIZE_TO_INT = {'10 yard': 10, '15 yard': 15, '20 yard': 20, '30 yard': 30, '40 yd': 40}
STANDARD_TONS_BY_SIZE = {10: 1, 20: 2, 30: 3, 40: 4}  # no established convention for 15 YD

NOT_OFFERED = {'', 'n/a', 'na', '-', 'n\\a', 'none'}

STATE_TO_ABBR = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT',
    'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI',
    'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME',
    'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI',
    'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM',
    'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
    'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA',
    'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
    'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC',
}

PAREN_SIZE_RE = re.compile(r'\(\s*(\d+)\s*Y\s*D?\s*\)')
BARE_SIZE_PREFIX_RE = re.compile(r'^\s*(\d+)\s*YD?\s*(?:[/:\-]\s*|\s+|(?=\$))', re.IGNORECASE)
ZONE_PREFIX_RE = re.compile(r'^\s*zone\s*\d+\s*', re.IGNORECASE)
PRICE_SEARCH_FALLBACK_RE = re.compile(
    r'\$\s*([\d,]+(?:\.\d+)?)\s*(?:/\s*(flat|none|[\d.]+\s*T))?\s*(?:/\s*\$?\s*(\d+)\s*d(?:ays?)?)?',
    re.IGNORECASE,
)
PRICE_RE = re.compile(
    r'^\$?\s*([\d,]+(?:\.\d+)?)\s*(?:/\s*(flat|none|[\d.]+\s*T))?\s*(?:/\s*\$?\s*(\d+)\s*d(?:ays?)?)?',
    re.IGNORECASE,
)
DAYS_ONLY_RE = re.compile(r'(\d+)\s*Days?', re.IGNORECASE)
AVAILABLE_ONLY_RE = re.compile(r'^\s*available\b', re.IGNORECASE)
PRICE_ONLY_LOOKS_LIKE_DAYS_RE = re.compile(r'^\s*\d+\s*d(?:ays?)?\s*$', re.IGNORECASE)
DELIVERY_PREFIX_RE = re.compile(r'^\$?\s*([\d.]+)\s*del(?:ivery)?\b\s*/?\s*', re.IGNORECASE)
HAUL_RATE_RE = re.compile(r'\$?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*)?haul\b', re.IGNORECASE)
BARE_HAUL_DOLLAR_DAYS_RE = re.compile(r'^\$\s*([\d,]+(?:\.\d+)?)\s*/\s*(\d+)\s*Days?', re.IGNORECASE)
PER_TON_RE = re.compile(r'\$?\s*([\d.]+)\s*\$?\s*(?:Per\s*Ton|/\s*Ton\b|/\s*T\b)', re.IGNORECASE)
PER_DAY_RE = re.compile(r'\$?\s*([\d.]+)\s*\$?\s*(?:Per\s*Day|/\s*Day\b|/\s*D\b)', re.IGNORECASE)
PER_WEEK_RE = re.compile(r'\$?\s*([\d.]+)\s*\$?\s*(?:Per\s*Week|/\s*Week\b|/\s*Wk\b)', re.IGNORECASE)
# Some vendors write a debris-qualified rate straight into the Other
# column instead of using the dedicated CnD Waste / Mixed Waste columns
# ("$35 Per CnD Ton   $50 Per MSW Ton") -- used only as a fallback when
# those dedicated columns are blank, so a real per-column value always
# wins over free text.
CND_TON_IN_OTHER_RE = re.compile(r'\$?\s*([\d.]+)\s*Per\s*(?:CnD|C&D)\s*Ton', re.IGNORECASE)
MIXED_TON_IN_OTHER_RE = re.compile(r'\$?\s*([\d.]+)\s*Per\s*(?:MSW|HH|Mixed|Household)\s*Ton', re.IGNORECASE)
ONE_TIME_FLAT_RE = re.compile(r'(?:add\s*)?\$?\s*([\d.]+)\s*one\s*time', re.IGNORECASE)
ONE_TIME_PCT_RE = re.compile(r'([\d.]+)\s*%', re.IGNORECASE)
DELIVERY_INLINE_RE = re.compile(r'\$?\s*([\d.]+)\s*(?:a\s*)?del(?:ivery)?\b', re.IGNORECASE)
DAYS_FLEXIBLE_RE = re.compile(r'(\d+)\s*d(?:ay)?s?\b(?:\s*rental)?', re.IGNORECASE)
PCT_RE = re.compile(r'([\d.]+)\s*%')
FLAT_DOLLAR_RE = re.compile(r'\$\s*([\d.]+)')
ZIP_EXTRACT_RE = re.compile(r'\b(\d{5})\b')
SEE_CONTAINER_PHRASES = ('see container',)  # matches "see container size", "see container size rate", "see container pricing rate"

NOTICE_MODELS = {'must_call_for_pricing', 'franchised', 'do_not_price_quote'}


def clean(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    return v


def as_number(v):
    """Coerces to a real number, or None -- never lets a text sentinel like
    'Flat' or 'See container size rate' silently leak into arithmetic."""
    if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
        return float(v)
    return None


def is_offered(raw):
    if raw is None:
        return False
    if isinstance(raw, float) and math.isnan(raw):
        return False
    s = str(raw).strip().lower()
    return s not in NOT_OFFERED


def normalize_pricing_model(raw):
    """Returns (model, debrisType) or None to skip the row. Whether a
    Haul + Disposal row is parsed per-size is decided later, per-cell,
    from the Haul Rate column text -- not from the model name, since
    Dee's data now signals it either way."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None  # no pricing model at all -- no vendor, per Dee
    s = str(raw).strip().lower()
    if not s:
        return None
    if 'do not price quote' in s or s == 'dnq':
        return ('do_not_price_quote', None)
    if 'must call' in s:
        return ('must_call_for_pricing', None)
    if 'franchise' in s:
        return ('franchised', None)
    if 'haul' in s:
        return ('haul_plus_disposal', None)
    if s == 'standard mixed':
        return ('standard', 'mixed')
    if s == 'standard cnd':
        return ('standard', 'cnd')
    if s == 'standard':
        return ('standard', None)
    if s == 'flat rate residential':
        return ('flat', 'mixed')
    if s == 'flat rate cnd':
        return ('flat', 'cnd')
    if s in ('flat rate', 'flat'):
        return ('flat', None)
    return None  # unrecognized model -- skip rather than guess


def strip_size_note(raw):
    """Pulls a real-size note out of a cell, whichever format it's in --
    '(12YD)', '12YD-', '12 YD:', '12YD/' -- returns (remaining_text, note,
    zone_label). Also strips a leading 'Zone N' service-area label some
    vendors use (kept separately as an admin-reference field, since it
    isn't needed for routing -- every city LAM Hauling uses it for maps
    to exactly one zone already, so the existing city-based matching
    already resolves it correctly)."""
    s = str(raw)
    zone_m = ZONE_PREFIX_RE.match(s)
    zone_label = f'Zone {re.search(r"\d+", zone_m.group()).group()}' if zone_m else None
    s = ZONE_PREFIX_RE.sub('', s)
    m = PAREN_SIZE_RE.search(s)
    if m:
        return PAREN_SIZE_RE.sub('', s).strip(), f'{m.group(1)}YD', zone_label
    m = BARE_SIZE_PREFIX_RE.match(s)
    if m:
        return BARE_SIZE_PREFIX_RE.sub('', s).strip(), f'{m.group(1)}YD', zone_label
    return s.strip(), None, zone_label


def parse_standard_or_flat_cell(raw):
    """Returns dict with price/rawTons/days/isFlatCell, or None if unparseable.
    Tries an anchored match first (the normal case); if the cell has some
    other label/descriptor text before the real price (a phrasing we
    haven't seen enough to name specifically, unlike the Zone/size-note
    prefixes stripped above), falls back to finding a '$X/tons/days'
    chunk anywhere in the cell rather than giving up. A leading '$X del'
    fee is stripped and returned separately -- otherwise it reads as if
    it were the whole price (a real, confirmed bug: '$100 del $200/...'
    was pricing the container at $100 instead of $200)."""
    cleaned, note, zone_label = strip_size_note(raw)
    delivery_override = None
    del_m = DELIVERY_PREFIX_RE.match(cleaned)
    if del_m:
        delivery_override = float(del_m.group(1))
        cleaned = DELIVERY_PREFIX_RE.sub('', cleaned)

    stripped = cleaned.strip()
    if PRICE_ONLY_LOOKS_LIKE_DAYS_RE.match(stripped):
        return None  # e.g. a bare "14 Days" with no price at all -- not a price

    m = PRICE_RE.match(stripped)
    if not m:
        m = PRICE_SEARCH_FALLBACK_RE.search(cleaned)
    if not m:
        return None
    price = float(m.group(1).replace(',', ''))
    tons_raw = m.group(2)
    days_raw = m.group(3)
    is_flat = bool(tons_raw and 'flat' in tons_raw.lower())
    is_unspecified_tons = bool(tons_raw and tons_raw.lower() == 'none')
    raw_tons = (None if (not tons_raw or is_flat or is_unspecified_tons)
                else float(tons_raw.lower().replace('t', '').strip()))
    days = int(days_raw) if days_raw else None
    return {'price': price, 'rawTons': raw_tons, 'days': days, 'isFlatCell': is_flat,
            'realSizeNote': note, 'deliveryOverride': delivery_override, 'zoneLabel': zone_label}


def parse_haul_cell(raw, per_size_mode):
    """Independent field-by-field extraction rather than one rigid anchored
    pattern -- the real data mixes at least 50 different cell shapes for
    this model (with/without '$', with/without 'Per', 'Haul' vs 'haul',
    'Days' vs 'Day Rental', embedded per-ton/delivery overrides, a bare
    size+days cell with no price at all, and 'Available' meaning
    must-call for that one size). Returns a dict, or a dict with
    sizeMustCall=True for an 'Available'-only cell, or None only if truly
    nothing usable is in the cell at all.
    """
    s = str(raw)
    cleaned, note, zone_label = strip_size_note(s)

    if AVAILABLE_ONLY_RE.match(cleaned) and not re.search(r'\d', cleaned):
        return {'sizeMustCall': True, 'realSizeNote': note}

    days_m = DAYS_FLEXIBLE_RE.search(cleaned)
    days = int(days_m.group(1)) if days_m else None

    if not per_size_mode:
        # Shared Haul Rate column is the real price; this cell is just
        # confirming the size is offered, with rental days if given.
        return {'days': days, 'realSizeNote': note, 'zoneLabel': zone_label}

    haul_m = HAUL_RATE_RE.search(cleaned)
    haul_rate = float(haul_m.group(1).replace(',', '')) if haul_m else None
    if haul_rate is None:
        # No 'haul' keyword at all -- a few vendors just write "$315/7 Days"
        bare_m = BARE_HAUL_DOLLAR_DAYS_RE.match(cleaned)
        if bare_m:
            haul_rate = float(bare_m.group(1).replace(',', ''))
            days = int(bare_m.group(2))

    ton_m = PER_TON_RE.search(cleaned)
    ton_override = float(ton_m.group(1)) if ton_m else None
    delivery_m = DELIVERY_INLINE_RE.search(cleaned)
    delivery_override = float(delivery_m.group(1)) if delivery_m else None

    if haul_rate is None:
        return None  # genuinely couldn't find a price -- skip, don't guess

    return {
        'haulRate': haul_rate, 'days': days, 'realSizeNote': note, 'zoneLabel': zone_label,
        'tonOverride': ton_override, 'deliveryOverride': delivery_override,
    }


def parse_overage(raw):
    """Extracts a per-ton, per-day, AND per-week rate independently -- a
    single 'Other' cell very often carries two of these at once
    ('$35 Per Ton $10 Per Day', '$60/T, $30/week'). Per-week is kept
    separate rather than silently divided into a daily rate -- whether a
    vendor bills that in daily increments or only in full extra weeks is
    a real billing-behavior question, not something to assume."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return {'ton': None, 'day': None, 'week': None}
    s = str(raw)
    ton_m = PER_TON_RE.search(s)
    day_m = PER_DAY_RE.search(s)
    week_m = PER_WEEK_RE.search(s)
    return {
        'ton': float(ton_m.group(1)) if ton_m else None,
        'day': float(day_m.group(1)) if day_m else None,
        'week': float(week_m.group(1)) if week_m else None,
    }


def parse_debris_ton_override(raw, other_text, other_pattern):
    """CnD Waste / Mixed Waste columns: '$57 Per Ton' -> 57.0. Falls back
    to a debris-qualified rate embedded in the Other column ('$35 Per
    CnD Ton') only when the dedicated column itself is blank -- a real
    per-column value always wins over free text."""
    if raw is not None and not (isinstance(raw, float) and math.isnan(raw)):
        m = PER_TON_RE.search(str(raw))
        if m:
            return float(m.group(1))
    if other_text:
        m = other_pattern.search(str(other_text))
        if m:
            return float(m.group(1))
    return None


def parse_one_time_charge(raw):
    """'One Time Mixed Charge' / 'One Time CnD Charge' columns -- an
    adjustment to the BASE price (not a per-ton rate) that applies only
    for that specific debris type. Returns (flatAmount, percentFraction);
    at most one is non-zero given the observed formats ('Add $50 one
    time' / 'Add 17% of base dumpster cost' / '10% of dumpster total
    cost'). Applied in quote-engine.js at compute time (not baked into
    the price here), since Haul + Disposal's total depends on the
    rep-adjustable tons and can't be precomputed once at conversion."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return (0.0, 0.0)
    s = str(raw)
    flat_m = ONE_TIME_FLAT_RE.search(s)
    if flat_m:
        return (float(flat_m.group(1)), 0.0)
    pct_m = ONE_TIME_PCT_RE.search(s)
    if pct_m:
        return (0.0, float(pct_m.group(1)) / 100.0)
    return (0.0, 0.0)


def parse_zips(raw):
    """Pulls every valid-looking 5-digit zip out of a cell, regardless of
    formatting -- most cells are a flat comma list, but ~236 use a
    'CityName (zip zip zip) CityName2 (zip zip zip)' compound format for
    a shared multi-town coverage group. A naive comma-split mangles that
    format into garbage fragments (a literal bug found while building
    this); pulling every 5-digit token instead works for both shapes and
    never produces a non-zip 'zip'."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return []
    return ZIP_EXTRACT_RE.findall(str(raw))


def parse_fuel_surcharge(raw):
    """Returns (flatAmount, percentFraction). Either may be 0; a row can
    have both (e.g. '$25 + 20% on disposal costs')."""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return (0.0, 0.0)
    if isinstance(raw, (int, float)):
        return (float(raw), 0.0)
    s = str(raw)
    pct_m = PCT_RE.search(s)
    dollar_m = FLAT_DOLLAR_RE.search(s)
    percent = float(pct_m.group(1)) / 100.0 if pct_m else 0.0
    flat = float(dollar_m.group(1)) if (dollar_m and pct_m) else 0.0
    if not pct_m and dollar_m:
        flat = float(dollar_m.group(1))
    return (flat, percent)


def convert(xlsx_path):
    df = pd.read_excel(xlsx_path, sheet_name='Sheet1')
    rules = []
    skipped = []
    no_model_skipped = 0
    rule_id = 1

    for _, row in df.iterrows():
        model_info = normalize_pricing_model(row.get('Pricing Model'))
        if model_info is None:
            no_model_skipped += 1
            continue
        model, model_debris = model_info

        # A Haul + Disposal row whose Haul Rate literally says "Flat
        # Rate" (not "see container...") isn't really haul+per-ton at
        # all -- the size cells are priced exactly like a Flat Rate
        # vendor ("$390/flat/30 Days"), just filed under the wrong model
        # name. Route it through the flat-price path instead, rather
        # than into haulRate/perTon fields it doesn't actually have.
        haul_rate_text = row.get('Haul Rate')
        if (model == 'haul_plus_disposal' and isinstance(haul_rate_text, str)
                and 'flat' in haul_rate_text.lower() and 'see container' not in haul_rate_text.lower()):
            model = 'flat'

        state_full = clean(row.get('State'))
        state_abbr = STATE_TO_ABBR.get(state_full, state_full)
        city = clean(row.get('City'))
        vendor = clean(row.get('Vendor')) or 'Unnamed vendor'
        phone = clean(row.get('Phone'))
        delivery = as_number(row.get('Delivery')) or 0
        fuel_flat, fuel_percent = parse_fuel_surcharge(row.get('Fuel Surcharge'))
        tax_rate = as_number(row.get('Sales Tax Rate')) or 0
        overage = parse_overage(row.get('Other'))
        other_text = row.get('Other')
        cnd_override = parse_debris_ton_override(row.get('CnD Waste'), other_text, CND_TON_IN_OTHER_RE)
        mixed_override = parse_debris_ton_override(row.get('Mixed Waste'), other_text, MIXED_TON_IN_OTHER_RE)
        one_time_mixed_flat, one_time_mixed_pct = parse_one_time_charge(row.get('One Time Mixed Charge'))
        one_time_cnd_flat, one_time_cnd_pct = parse_one_time_charge(row.get('One Time CnD Charge'))
        shared_haul_rate = as_number(row.get('Haul Rate'))
        shared_ton_rate = as_number(row.get('Tonnage Rate'))
        zips = parse_zips(row.get('Zipcodes by City'))

        def charge_fields_for(debris_type):
            """One-time base-price adjustment fields for a given debris
            variant -- applied at compute time in quote-engine.js, not
            baked in here, so it works correctly even for Haul + Disposal
            rows where the total depends on rep-adjustable tons."""
            if debris_type == 'mixed':
                return {'oneTimeFlat': one_time_mixed_flat or 0, 'oneTimePercent': one_time_mixed_pct or 0}
            if debris_type == 'cnd':
                return {'oneTimeFlat': one_time_cnd_flat or 0, 'oneTimePercent': one_time_cnd_pct or 0}
            return {'oneTimeFlat': 0, 'oneTimePercent': 0}
        # Per-size mode is signaled either by the Haul Rate column being
        # text ("See container size rate" / "see container pricing rate" /
        # etc, all non-numeric) or by the old explicit "...Commercial -
        # See container size..." model name Dee used before consolidating.
        haul_rate_raw = row.get('Haul Rate')
        per_size_mode = (
            (isinstance(haul_rate_raw, str) and 'see container' in haul_rate_raw.lower())
            or (isinstance(row.get('Pricing Model'), str) and 'see container' in row.get('Pricing Model').lower())
        )
        # "Tonnage Rate: Flat" means disposal is bundled into the haul
        # rate itself -- no per-ton component at all for this vendor.
        ton_rate_is_flat = isinstance(row.get('Tonnage Rate'), str) and row.get('Tonnage Rate').strip().lower() == 'flat'

        for col in SIZE_COLUMNS:
            raw_val = row.get(col)
            if not is_offered(raw_val):
                continue
            size = SIZE_TO_INT[col]

            base = {
                'vendor': vendor, 'phone': phone, 'city': city, 'state': state_abbr,
                'size': size, 'pricingModel': model,
                'delivery': delivery,
                'fuelSurchargeFlat': fuel_flat, 'fuelSurchargePercent': fuel_percent,
                'taxRate': tax_rate,
                'rawCell': str(raw_val),
                'zips': zips,
            }

            if model in NOTICE_MODELS:
                rule = {**base, 'debrisType': None,
                        'haulRate': None, 'perTon': None, 'price': None,
                        'rawTons': None, 'rentalDays': None,
                        'tonOverageRate': None, 'dayOverageRate': None, 'weekOverageRate': None,
                        'realSizeNote': None, 'zoneLabel': None, 'oneTimeFlat': 0, 'oneTimePercent': 0}
                rule['id'] = f'p{rule_id}'; rule_id += 1
                rules.append(rule)
                continue

            if model == 'haul_plus_disposal':
                parsed = parse_haul_cell(raw_val, per_size_mode)
                if parsed is None:
                    skipped.append((state_full, city, vendor, col, raw_val))
                    continue
                if parsed.get('sizeMustCall'):
                    # This specific size needs a call -- same notice
                    # treatment as a must_call_for_pricing row, scoped to
                    # just this size rather than the whole vendor.
                    rule = {**base, 'pricingModel': 'must_call_for_pricing',
                            'debrisType': None, 'haulRate': None, 'perTon': None,
                            'price': None, 'rawTons': None, 'rentalDays': None,
                            'tonOverageRate': None, 'dayOverageRate': None, 'weekOverageRate': None,
                            'realSizeNote': parsed.get('realSizeNote'), 'zoneLabel': parsed.get('zoneLabel'), 'oneTimeFlat': 0, 'oneTimePercent': 0}
                    rule['id'] = f'p{rule_id}'; rule_id += 1
                    rules.append(rule)
                    continue

                haul_rate = parsed.get('haulRate') if per_size_mode else shared_haul_rate
                if parsed.get('deliveryOverride') is not None:
                    base = {**base, 'delivery': parsed['deliveryOverride']}
                if haul_rate is None:
                    skipped.append((state_full, city, vendor, col, raw_val))
                    continue

                base_ton_rate = 0 if ton_rate_is_flat else (parsed.get('tonOverride') if parsed.get('tonOverride') is not None else shared_ton_rate)
                variants = [(None, base_ton_rate)]
                if cnd_override is not None:
                    variants.append(('cnd', cnd_override))
                elif one_time_cnd_flat or one_time_cnd_pct:
                    variants.append(('cnd', base_ton_rate))
                if mixed_override is not None:
                    variants.append(('mixed', mixed_override))
                elif one_time_mixed_flat or one_time_mixed_pct:
                    variants.append(('mixed', base_ton_rate))
                for debris_type, per_ton in variants:
                    if per_ton is None:
                        # Genuinely no per-ton rate anywhere (not "Flat" --
                        # actually blank) -- Haul + Disposal's whole price
                        # is haulRate + perTon*tons, so this can't be
                        # priced at all without it. A previous version of
                        # this script used "per_ton or 0" here, which
                        # silently turned "we don't know" into "confirmed
                        # $0" -- a real bug (found via Rocky Mountain Roll
                        # Off, though that one turned out to be a genuine
                        # $0/Flat case; 400 other rows across 19 vendors
                        # were true unknowns wrongly shown as $0). Skip
                        # rather than show an understated price.
                        skipped.append((state_full, city, vendor, col, f'{raw_val} [no ton rate on file]'))
                        continue
                    rule = {**base, 'debrisType': debris_type,
                            'haulRate': haul_rate, 'perTon': per_ton,
                            'price': None, 'rawTons': None,
                            'rentalDays': parsed['days'],
                            'tonOverageRate': per_ton, 'dayOverageRate': overage['day'], 'weekOverageRate': overage['week'],
                            'realSizeNote': parsed.get('realSizeNote'), 'zoneLabel': parsed.get('zoneLabel'),
                            **charge_fields_for(debris_type)}
                    rule['id'] = f'p{rule_id}'; rule_id += 1
                    rules.append(rule)
                continue

            # standard / flat
            parsed = parse_standard_or_flat_cell(raw_val)
            if parsed is None:
                skipped.append((state_full, city, vendor, col, raw_val))
                continue
            if parsed.get('deliveryOverride') is not None:
                base = {**base, 'delivery': parsed['deliveryOverride']}

            if model_debris is not None:
                # Pricing-model-driven debris split (Standard Mixed/CnD,
                # Flat Rate Residential/CnD) -- single rule, matching
                # override column (if present) replaces the generic rate.
                override = {'cnd': cnd_override, 'mixed': mixed_override}[model_debris]
                ton_rate = override if override is not None else overage['ton']
                rule = {**base, 'debrisType': model_debris,
                        'haulRate': None, 'perTon': None,
                        'price': parsed['price'], 'rawTons': parsed['rawTons'],
                        'rentalDays': parsed['days'],
                        'tonOverageRate': None if model == 'flat' else ton_rate,
                        'dayOverageRate': overage['day'], 'weekOverageRate': overage['week'],
                        'realSizeNote': parsed.get('realSizeNote'), 'zoneLabel': parsed.get('zoneLabel'),
                        **charge_fields_for(model_debris)}
                rule['id'] = f'p{rule_id}'; rule_id += 1
                rules.append(rule)
            else:
                # Generic Standard/Flat row -- may still split via CnD
                # Waste / Mixed Waste override columns (Standard only;
                # these columns are never populated for Flat Rate rows),
                # and/or a "One Time Mixed/CnD Charge" -- an addition to
                # the BASE price (not a ton rate) applied at compute time
                # in quote-engine.js, not baked in here. If a dedicated
                # ton-rate override exists AND a one-time charge also
                # exists, both apply together; if only the one-time
                # charge exists, that variant still uses the generic ton
                # rate.
                base_price = parsed['price']
                variants = [(None, overage['ton'])]
                if model == 'standard':
                    if cnd_override is not None:
                        variants.append(('cnd', cnd_override))
                    elif one_time_cnd_flat or one_time_cnd_pct:
                        variants.append(('cnd', overage['ton']))
                    if mixed_override is not None:
                        variants.append(('mixed', mixed_override))
                    elif one_time_mixed_flat or one_time_mixed_pct:
                        variants.append(('mixed', overage['ton']))
                for debris_type, ton_rate in variants:
                    rule = {**base, 'debrisType': debris_type,
                            'haulRate': None, 'perTon': None,
                            'price': base_price, 'rawTons': parsed['rawTons'],
                            'rentalDays': parsed['days'],
                            'tonOverageRate': None if model == 'flat' else ton_rate,
                            'dayOverageRate': overage['day'], 'weekOverageRate': overage['week'],
                            'realSizeNote': parsed.get('realSizeNote'), 'zoneLabel': parsed.get('zoneLabel'),
                            **charge_fields_for(debris_type)}
                    rule['id'] = f'p{rule_id}'; rule_id += 1
                    rules.append(rule)

    return rules, skipped, no_model_skipped


def build_zip3_to_state():
    """A ~930-entry zip-prefix -> state table (tiny -- doesn't meaningfully
    add to data.js size) used only as a last-resort fallback: when a
    searched zip matches no vendor's coverage at all, this is how the site
    still knows which state to run the state-average estimate for. Built
    from the public 'zipcodes' package each run, majority-vote per prefix
    for the handful of prefixes that straddle a state line."""
    prefix_states = defaultdict(Counter)
    for z in zipcodes.list_all():
        prefix_states[z['zip_code'][:3]][z['state']] += 1
    return {p: c.most_common(1)[0][0] for p, c in prefix_states.items()}


def to_js(rules, out_path):
    header = '''/* =========================================================
   VENDOR DATA — generated by tools/convert-vendor-sheet.py
   Source: Master Vendor Sheet (post-cleanup)
   Regenerate by re-running the script against a newer Master Sheet --
   nothing else in the site needs to change unless the column layout
   itself changes.
   ========================================================= */

export const STANDARD_TONS_BY_SIZE = ''' + json.dumps(STANDARD_TONS_BY_SIZE) + ''';

export const SIZES = [10, 15, 20, 30, 40];

export const DEBRIS_TYPES = [
  { id: 'cnd', name: 'CnD / Construction' },
  { id: 'mixed', name: 'Mixed / Household' },
];

/* Zip-prefix -> state, last-resort fallback only (see quote-engine.js) --
   the real zip matching is done directly against each PRICING_RULES row's
   own "zips" list, sourced from the Master Sheet's Zipcodes by City
   column. */
export const ZIP3_TO_STATE = ''' + json.dumps(build_zip3_to_state(), separators=(',', ':')) + ''';

export const MARGIN_DIVISOR = 0.74;
export const CC_FEE_RATE = 0.035;
export const ESTIMATE_BUMP = 1.15;
export const ESTIMATE_RENTAL_DAYS = 7;

'''
    # PRICING_RULES is split across several data-partN.js files rather
    # than living in data.js itself. Not a performance change -- the
    # browser still loads the same total bytes -- purely so each
    # individual file stays under GitHub's 25MB drag-and-drop upload
    # limit, since that's Dee's actual deployment method. Each part just
    # exports its own slice; data.js imports and concatenates them, so
    # nothing else in the site (or Dee's workflow beyond dragging in a
    # few files instead of one) needs to change. Re-split automatically
    # every run, so this keeps working as the data set keeps growing.
    PART_COUNT = 4
    n = len(rules)
    chunk = math.ceil(n / PART_COUNT) if n else 0
    out_dir = os.path.dirname(out_path)
    imports = []
    combine = []
    for i in range(PART_COUNT):
        part_rules = rules[i * chunk:(i + 1) * chunk]
        part_name = f'data-part{i + 1}.js'
        part_path = os.path.join(out_dir, part_name)
        part_body = json.dumps(part_rules, separators=(',', ':'))
        with open(part_path, 'w') as f:
            f.write(f'export const PRICING_RULES_PART_{i + 1} = {part_body};\n')
        imports.append(f"import {{ PRICING_RULES_PART_{i + 1} }} from './{part_name}';")
        combine.append(f'...PRICING_RULES_PART_{i + 1}')

    header = '\n'.join(imports) + '\n\n' + header
    footer = f"export const PRICING_RULES = [{', '.join(combine)}];\n"
    with open(out_path, 'w') as f:
        f.write(header + footer)


if __name__ == '__main__':
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/uploads/MasterVendorList-cleaned.xlsx'
    out_path = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/website/js/data.js'
    rules, skipped, no_model_skipped = convert(xlsx_path)
    to_js(rules, out_path)
    print(f'Wrote {len(rules)} pricing rules to {out_path}')
    print(f'{no_model_skipped} rows had no Pricing Model and were skipped entirely (no vendor).')
    if skipped:
        print(f'{len(skipped)} cells could not be parsed and were skipped:')
        for s in skipped[:50]:
            print(' ', s)
        if len(skipped) > 50:
            print(f'  ... and {len(skipped) - 50} more')
