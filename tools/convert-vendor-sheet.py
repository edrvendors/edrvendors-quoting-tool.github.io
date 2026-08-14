"""
Converts the vendor pricing Excel sheet into js/data.js for the quote site.

Usage:
    python3 convert-vendor-sheet.py <path-to-xlsx> <output-path-for-data.js>

Built against the "HallmarkWebsiteTester.xlsx" filler sheet (412 rows, no zip
column). Column layout expected:
    State, City, Vendor, Phone, Pricing Model, Delivery, Haul Rate, Per Ton,
    Fuel Surcharge, 10 YD, 15 YD, 20 YD, 30 YD, 40 YD, Other, Other2

Two columns are read if present, but are optional and safely skipped if
missing (the filler sheet has neither) — both feed the sales-side
"suggested price" estimate for areas with no vendor on file:
  - "Zip" — vendor's zip code. Powers exact zip-match lookups once filled
    in on the real sheet; until then this is just None for every row.
  - "Sales Tax Rate" — this state's rate. Assumed to be a decimal fraction
    (0.07 for 7%); a value greater than 1 is treated as a whole-number
    percent and divided by 100. Worth double-checking against the real
    column's actual format once it's added to the Master Sheet.

Rules applied (confirmed with Dee):
  - An empty size column means the vendor does not offer that size at all.
  - Haul + Disposal size cells hold ONLY a rental-period string ("7 Days") —
    the price is computed from Haul Rate + Per Ton, not read from the cell.
  - Standard / flat size cells hold a packed "$price/tons/days" (or
    "$price/flat/days") string. Parenthetical notes like "(actually 17YD)"
    are stripped and ignored — column position is trusted as the real size,
    per Dee's instruction, even where the sheet's own notes disagree.
  - The "Other" column holds an overage rate, either "$X Per Ton" or
    "$X Per Day". A bare number with no unit is assumed Per Ton unless the
    pricing model is "flat" (which ignores tonnage), in which case it's
    assumed Per Day. This is a placeholder heuristic — Dee's planned fix is
    splitting "Other" into two explicit columns.
  - A missing Pricing Model defaults to "standard".
  - "Other2" is not parsed — it's freeform notes with no consistent format
    across the sheet (confirmed while reviewing the tester file).
"""
import sys
import re
import json
import pandas as pd

SIZE_COLUMNS = ['10 YD', '15 YD', '20 YD', '30 YD', '40 YD']
STANDARD_TONS_BY_SIZE = {10: 1, 20: 2, 30: 3, 40: 4}  # no established convention for 15 YD

PRICE_RE = re.compile(
    r'^\$?\s*([\d,]+(?:\.\d+)?)\s*(?:/\s*(flat|[\d.]+\s*T))?\s*(?:/\s*(\d+)\s*Days?)?',
    re.IGNORECASE,
)
DAYS_ONLY_RE = re.compile(r'^(\d+)\s*Days?$', re.IGNORECASE)
PER_TON_RE = re.compile(r'^([\d.]+)\s*Per\s*Ton$', re.IGNORECASE)
PER_DAY_RE = re.compile(r'^([\d.]+)\s*Per\s*Day$', re.IGNORECASE)
BARE_NUM_RE = re.compile(r'^([\d.]+)$')


def clean(v):
    return None if pd.isna(v) else v


def clean_zip(v):
    """Handles zips read as either text ('34769') or a number (34769.0,
    which loses any leading zero) — returns a plain 5-digit string, or
    None if the cell is blank. Doesn't attempt to fix zips already stored
    wrong on the sheet (e.g. 4-digit) — leaves those as-is rather than guess."""
    if pd.isna(v):
        return None
    if isinstance(v, float):
        v = int(v)
    s = str(v).strip()
    return s.zfill(5) if s.isdigit() and len(s) <= 5 else s


def clean_tax_rate(v):
    """Assumes a decimal fraction (0.07); a value over 1 is treated as a
    whole-number percent (7 -> 0.07). Confirm this matches the real
    column's format once Sales Tax Rate is added to the Master Sheet."""
    if pd.isna(v):
        return None
    v = float(v)
    return v / 100 if v > 1 else v


def parse_size_cell(raw, pricing_model_norm):
    """Returns a dict describing one size column's contents, or None if unparsed."""
    s = re.sub(r'\([^)]*\)', '', str(raw)).strip()  # drop "(actually 17YD)"-style notes

    if pricing_model_norm == 'haul_plus_disposal':
        m = DAYS_ONLY_RE.match(s)
        return {'days': int(m.group(1))} if m else None

    m = PRICE_RE.match(s)
    if not m:
        return None
    price = float(m.group(1).replace(',', ''))
    tons_raw = m.group(2)
    days_raw = m.group(3)
    is_flat = bool(tons_raw and 'flat' in tons_raw.lower())
    raw_tons = None if not tons_raw or is_flat else float(tons_raw.lower().replace('t', '').strip())
    days = int(days_raw) if days_raw else None
    return {'price': price, 'rawTons': raw_tons, 'days': days, 'isFlatCell': is_flat}


def parse_overage(raw, pricing_model_norm):
    if pd.isna(raw):
        return {'ton': None, 'day': None}
    s = str(raw).replace('$', '').strip()
    m = PER_TON_RE.match(s)
    if m:
        return {'ton': float(m.group(1)), 'day': None}
    m = PER_DAY_RE.match(s)
    if m:
        return {'ton': None, 'day': float(m.group(1))}
    m = BARE_NUM_RE.match(s)
    if m:
        val = float(m.group(1))
        return ({'ton': None, 'day': val} if pricing_model_norm == 'flat'
                else {'ton': val, 'day': None})
    return {'ton': None, 'day': None}  # unrecognized format — skip rather than guess


def normalize_pricing_model(raw):
    if pd.isna(raw):
        return 'standard'
    s = str(raw).strip().lower()
    if 'haul' in s:
        return 'haul_plus_disposal'
    if s == 'flat':
        return 'flat'
    return 'standard'


def convert(xlsx_path):
    df = pd.read_excel(xlsx_path, sheet_name='Vendor List')
    rules = []
    skipped = []
    rule_id = 1

    for _, row in df.iterrows():
        model = normalize_pricing_model(row.get('Pricing Model'))
        overage = parse_overage(row.get('Other'), model)
        delivery = clean(row.get('Delivery')) or 0
        fuel = clean(row.get('Fuel Surcharge')) or 0
        vendor = clean(row.get('Vendor')) or 'Unnamed vendor'
        phone = clean(row.get('Phone'))
        zip_code = clean_zip(row.get('Zip'))
        tax_rate = clean_tax_rate(row.get('Sales Tax Rate'))

        for col in SIZE_COLUMNS:
            raw_val = row.get(col)
            if pd.isna(raw_val):
                continue  # no entry = vendor doesn't offer this size
            size = int(col.split(' ')[0])
            parsed = parse_size_cell(raw_val, model)
            if parsed is None:
                skipped.append((row.get('State'), row.get('City'), vendor, col, raw_val))
                continue

            rule = {
                'id': f'p{rule_id}',
                'vendor': vendor,
                'phone': phone,
                'city': clean(row.get('City')),
                'state': clean(row.get('State')),
                'zip': zip_code,
                'taxRate': tax_rate,
                'size': size,
                'pricingModel': model,
                'delivery': delivery,
                'fuelSurcharge': fuel,
                'tonOverageRate': overage['ton'],
                'dayOverageRate': overage['day'],
                'rawCell': str(raw_val),
            }

            if model == 'haul_plus_disposal':
                rule['haulRate'] = clean(row.get('Haul Rate'))
                rule['perTon'] = clean(row.get('Per Ton'))
                rule['rentalDays'] = parsed['days']
                rule['price'] = None
                rule['rawTons'] = None
            else:
                rule['haulRate'] = None
                rule['perTon'] = None
                rule['price'] = parsed['price']
                rule['rawTons'] = parsed['rawTons']
                rule['rentalDays'] = parsed['days']

            rules.append(rule)
            rule_id += 1

    return rules, skipped


def to_js(rules, out_path):
    header = '''/* =========================================================
   VENDOR DATA — generated by tools/convert-vendor-sheet.py
   Source: HallmarkWebsiteTester.xlsx (filler data, 412 rows, no zip column)
   Regenerate by re-running the script against the real Master Vendor
   Sheet once it's finished — nothing else in the site needs to change.
   ========================================================= */

export const STANDARD_TONS_BY_SIZE = ''' + json.dumps(STANDARD_TONS_BY_SIZE) + ''';

export const SIZES = [10, 15, 20, 30, 40];

export const DEBRIS_TYPES = [
  { id: 'cnd', name: 'CnD / Construction' },
  { id: 'mixed', name: 'Mixed / Household' },
  { id: 'concrete', name: 'Concrete' },
  { id: 'shingles', name: 'Shingles' },
  { id: 'yard', name: 'Yard Waste' },
];
// NOTE: this filler sheet has no debris-type column, so every vendor below
// is treated as handling all debris types for now. The dropdown is wired
// up and ready for when the real sheet has per-vendor debris data.

export const MARGIN_DIVISOR = 0.74;

export const PRICING_RULES = '''
    body = json.dumps(rules, indent=2)
    footer = ';\n'
    with open(out_path, 'w') as f:
        f.write(header + body + footer)


if __name__ == '__main__':
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/uploads/HallmarkWebsiteTester.xlsx'
    out_path = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/website/js/data.js'
    rules, skipped = convert(xlsx_path)
    to_js(rules, out_path)
    print(f'Wrote {len(rules)} pricing rules to {out_path}')
    if skipped:
        print(f'{len(skipped)} cells could not be parsed and were skipped:')
        for s in skipped:
            print(' ', s)
