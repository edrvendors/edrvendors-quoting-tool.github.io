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
import json
import math
import pandas as pd

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
BARE_SIZE_PREFIX_RE = re.compile(r'^\s*(\d+)\s*YD?\s*[/:\-]\s*', re.IGNORECASE)
ZONE_PREFIX_RE = re.compile(r'^\s*zone\s*\d+\s*', re.IGNORECASE)
PRICE_RE = re.compile(
    r'^\$?\s*([\d,]+(?:\.\d+)?)\s*(?:/\s*(flat|[\d.]+\s*T))?\s*(?:/\s*\$?\s*(\d+)\s*Days?)?',
    re.IGNORECASE,
)
DAYS_ONLY_RE = re.compile(r'(\d+)\s*Days?', re.IGNORECASE)
AVAILABLE_ONLY_RE = re.compile(r'^\s*available\b', re.IGNORECASE)
HAUL_RATE_RE = re.compile(r'\$?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s*)?haul\b', re.IGNORECASE)
BARE_HAUL_DOLLAR_DAYS_RE = re.compile(r'^\$\s*([\d,]+(?:\.\d+)?)\s*/\s*(\d+)\s*Days?', re.IGNORECASE)
PER_TON_RE = re.compile(r'\$?\s*([\d.]+)\s*Per\s*Ton', re.IGNORECASE)
PER_DAY_RE = re.compile(r'\$?\s*([\d.]+)\s*Per\s*Day', re.IGNORECASE)
DELIVERY_INLINE_RE = re.compile(r'\$?\s*([\d.]+)\s*(?:a\s*)?del(?:ivery)?\b', re.IGNORECASE)
DAYS_FLEXIBLE_RE = re.compile(r'(\d+)\s*d(?:ay)?s?\b(?:\s*rental)?', re.IGNORECASE)
PCT_RE = re.compile(r'([\d.]+)\s*%')
FLAT_DOLLAR_RE = re.compile(r'\$\s*([\d.]+)')
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
    '(12YD)', '12YD-', '12 YD:', '12YD/' -- returns (remaining_text, note).
    Also strips a leading 'Zone N' service-area label some vendors use,
    which isn't a real-size note but breaks price parsing the same way if
    left in (the raw cell text is preserved separately either way)."""
    s = ZONE_PREFIX_RE.sub('', str(raw))
    m = PAREN_SIZE_RE.search(s)
    if m:
        return PAREN_SIZE_RE.sub('', s).strip(), f'{m.group(1)}YD'
    m = BARE_SIZE_PREFIX_RE.match(s)
    if m:
        return BARE_SIZE_PREFIX_RE.sub('', s).strip(), f'{m.group(1)}YD'
    return s.strip(), None


def parse_standard_or_flat_cell(raw):
    """Returns dict with price/rawTons/days/isFlatCell, or None if unparseable."""
    cleaned, note = strip_size_note(raw)
    m = PRICE_RE.match(cleaned.strip())
    if not m:
        return None
    price = float(m.group(1).replace(',', ''))
    tons_raw = m.group(2)
    days_raw = m.group(3)
    is_flat = bool(tons_raw and 'flat' in tons_raw.lower())
    raw_tons = None if not tons_raw or is_flat else float(tons_raw.lower().replace('t', '').strip())
    days = int(days_raw) if days_raw else None
    return {'price': price, 'rawTons': raw_tons, 'days': days, 'isFlatCell': is_flat, 'realSizeNote': note}


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
    cleaned, note = strip_size_note(s)

    if AVAILABLE_ONLY_RE.match(cleaned) and not re.search(r'\d', cleaned):
        return {'sizeMustCall': True, 'realSizeNote': note}

    days_m = DAYS_FLEXIBLE_RE.search(cleaned)
    days = int(days_m.group(1)) if days_m else None

    if not per_size_mode:
        # Shared Haul Rate column is the real price; this cell is just
        # confirming the size is offered, with rental days if given.
        return {'days': days, 'realSizeNote': note}

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
        'haulRate': haul_rate, 'days': days, 'realSizeNote': note,
        'tonOverride': ton_override, 'deliveryOverride': delivery_override,
    }


def parse_overage(raw):
    """Extracts BOTH a per-ton and a per-day rate independently -- a single
    'Other' cell very often carries both ('$35 Per Ton $10 Per Day').""" 
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return {'ton': None, 'day': None}
    s = str(raw)
    ton_m = PER_TON_RE.search(s)
    day_m = PER_DAY_RE.search(s)
    return {
        'ton': float(ton_m.group(1)) if ton_m else None,
        'day': float(day_m.group(1)) if day_m else None,
    }


def parse_debris_ton_override(raw):
    """CnD Waste / Mixed Waste columns: '$57 Per Ton' -> 57.0"""
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    m = PER_TON_RE.search(str(raw))
    return float(m.group(1)) if m else None


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

        state_full = clean(row.get('State'))
        state_abbr = STATE_TO_ABBR.get(state_full, state_full)
        city = clean(row.get('City'))
        vendor = clean(row.get('Vendor')) or 'Unnamed vendor'
        phone = clean(row.get('Phone'))
        delivery = as_number(row.get('Delivery')) or 0
        fuel_flat, fuel_percent = parse_fuel_surcharge(row.get('Fuel Surcharge'))
        tax_rate = as_number(row.get('Sales Tax Rate')) or 0
        overage = parse_overage(row.get('Other'))
        cnd_override = parse_debris_ton_override(row.get('CnD Waste'))
        mixed_override = parse_debris_ton_override(row.get('Mixed Waste'))
        shared_haul_rate = as_number(row.get('Haul Rate'))
        shared_ton_rate = as_number(row.get('Tonnage Rate'))
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
            }

            if model in NOTICE_MODELS:
                rule = {**base, 'debrisType': None,
                        'haulRate': None, 'perTon': None, 'price': None,
                        'rawTons': None, 'rentalDays': None,
                        'tonOverageRate': None, 'dayOverageRate': None,
                        'realSizeNote': None}
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
                            'tonOverageRate': None, 'dayOverageRate': None,
                            'realSizeNote': parsed.get('realSizeNote')}
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
                if mixed_override is not None:
                    variants.append(('mixed', mixed_override))
                for debris_type, per_ton in variants:
                    rule = {**base, 'debrisType': debris_type,
                            'haulRate': haul_rate, 'perTon': per_ton or 0,
                            'price': None, 'rawTons': None,
                            'rentalDays': parsed['days'],
                            'tonOverageRate': per_ton or 0, 'dayOverageRate': overage['day'],
                            'realSizeNote': parsed.get('realSizeNote')}
                    rule['id'] = f'p{rule_id}'; rule_id += 1
                    rules.append(rule)
                continue

            # standard / flat
            parsed = parse_standard_or_flat_cell(raw_val)
            if parsed is None:
                skipped.append((state_full, city, vendor, col, raw_val))
                continue

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
                        'dayOverageRate': overage['day'],
                        'realSizeNote': parsed.get('realSizeNote')}
                rule['id'] = f'p{rule_id}'; rule_id += 1
                rules.append(rule)
            else:
                # Generic Standard/Flat row -- may still split via CnD
                # Waste / Mixed Waste override columns (Standard only;
                # these columns are never populated for Flat Rate rows).
                variants = [(None, overage['ton'])]
                if model == 'standard':
                    if cnd_override is not None:
                        variants.append(('cnd', cnd_override))
                    if mixed_override is not None:
                        variants.append(('mixed', mixed_override))
                for debris_type, ton_rate in variants:
                    rule = {**base, 'debrisType': debris_type,
                            'haulRate': None, 'perTon': None,
                            'price': parsed['price'], 'rawTons': parsed['rawTons'],
                            'rentalDays': parsed['days'],
                            'tonOverageRate': None if model == 'flat' else ton_rate,
                            'dayOverageRate': overage['day'],
                            'realSizeNote': parsed.get('realSizeNote')}
                    rule['id'] = f'p{rule_id}'; rule_id += 1
                    rules.append(rule)

    return rules, skipped, no_model_skipped


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

/* No zip column wired in yet -- zip search falls back to the state/
   regional estimate. */
export const ZIP_TO_LOCATION = {};

export const MARGIN_DIVISOR = 0.74;
export const CC_FEE_RATE = 0.035;
export const ESTIMATE_BUMP = 1.15;
export const ESTIMATE_RENTAL_DAYS = 7;

export const PRICING_RULES = '''
    # Minified on purpose -- at 50k+ rules, pretty-printing roughly
    # doubled the file size for zero benefit (nobody reads data.js by
    # eye; use the admin search UI or re-run this script against a row
    # range instead).
    body = json.dumps(rules, separators=(',', ':'))
    footer = ';\n'
    with open(out_path, 'w') as f:
        f.write(header + body + footer)


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
