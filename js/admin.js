import { searchAdmin, money } from './quote-engine.js';
import { DEBRIS_TYPES } from './data.js';

const DEBRIS_NAME = Object.fromEntries(DEBRIS_TYPES.map(d => [d.id, d.name]));
const resultsEl = document.getElementById('results');

const MODEL_LABEL = {
  standard: 'Standard',
  flat: 'Flat rate',
  haul_plus_disposal: 'Haul + Disposal',
  must_call_for_pricing: 'Must call for pricing',
  franchised: 'Franchised',
  do_not_price_quote: 'DO NOT PRICE QUOTE',
};

function currentFilters() {
  return {
    cityRaw: document.getElementById('city').value,
    stateRaw: document.getElementById('state').value,
    vendorRaw: document.getElementById('vendor').value,
  };
}

function fuelSurchargeDetail(row) {
  const parts = [];
  if (row.fuelSurchargeFlat) parts.push(money(row.fuelSurchargeFlat) + ' flat');
  if (row.fuelSurchargePercent) parts.push((row.fuelSurchargePercent * 100).toFixed(1) + '% of base price');
  return parts.length ? parts.join(' + ') : '\u2014';
}

function rawPricingDetail(row) {
  if (row.pricingModel === 'haul_plus_disposal') {
    return `<div>Haul rate: <b>${money(row.haulRate)}</b></div><div>Per ton: <b>${money(row.perTon)}</b></div>`;
  }
  if (row.pricingModel !== 'standard' && row.pricingModel !== 'flat') {
    return '';
  }
  const tonsLine = row.pricingModel === 'flat'
    ? '<div>Tonnage: <b>ignored (flat)</b></div>'
    : `<div>Real tons on file: <b>${row.rawTons ?? '\u2014'}</b></div>`;
  return `<div>Base price: <b>${money(row.price)}</b></div>${tonsLine}`;
}

function render(results) {
  resultsEl.innerHTML = '';

  if (!results.length) {
    resultsEl.innerHTML = `<div class="empty-state">Enter a city or vendor name above to search.</div>`;
    return;
  }

  results.forEach(({ row, price }) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    const modelLabel = MODEL_LABEL[row.pricingModel] || row.pricingModel;
    const debrisNote = row.debrisType ? ` · ${DEBRIS_NAME[row.debrisType] || row.debrisType}` : '';
    const dnqBadge = row.pricingModel === 'do_not_price_quote'
      ? '<span class="badge--alert">Do not price quote</span>' : '';
    const rawDetail = rawPricingDetail(row);

    card.innerHTML = `
      <div class="result-top">
        <div>
          <div class="result-size">${row.size} yd ${dnqBadge}</div>
          <div class="result-vendor">${row.vendor}${row.phone ? ' · ' + row.phone : ''}</div>
          <div class="result-city-note">${row.city}, ${row.state} · ${modelLabel}${debrisNote}</div>
        </div>
        <div class="result-total">${price.total != null ? money(price.total) : '\u2014'}</div>
      </div>
      <div class="admin-detail">
        ${rawDetail}
        <div>Rental days on file: <b>${row.rentalDays ?? '\u2014'}</b></div>
        <div>Delivery fee: <b>${money(row.delivery || 0)}</b></div>
        <div>Fuel surcharge: <b>${fuelSurchargeDetail(row)}</b></div>
        <div>Tax rate: <b>${row.taxRate != null ? (row.taxRate * 100).toFixed(2) + '%' : '\u2014'}</b></div>
        <div>Ton overage (raw): <b>${row.tonOverageRate != null ? money(row.tonOverageRate) + '/ton' : '\u2014'}</b></div>
        <div>Day overage (raw): <b>${row.dayOverageRate != null ? money(row.dayOverageRate) + '/day' : '\u2014'}</b></div>
        ${row.weekOverageRate != null ? `<div>Week overage (raw): <b>${money(row.weekOverageRate)}/week</b>${row.dayOverageRate == null ? ' — sales now sees this prorated ÷7 as an estimated daily rate' : ''}</div>` : ''}
        ${row.realSizeNote ? `<div>Real container size: <b>${row.realSizeNote}</b></div>` : ''}
        ${row.zoneLabel ? `<div>Vendor's internal pricing zone: <b>${row.zoneLabel}</b></div>` : ''}
      </div>
      <details class="breakdown">
        <summary>Original sheet cell</summary>
        <div class="breakdown-rows"><div class="breakdown-row"><span>${row.rawCell}</span><span></span></div></div>
      </details>
    `;
    resultsEl.appendChild(card);
  });
}

document.getElementById('search-btn').addEventListener('click', () => render(searchAdmin(currentFilters())));
['city', 'vendor'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') render(searchAdmin(currentFilters()));
  });
});
