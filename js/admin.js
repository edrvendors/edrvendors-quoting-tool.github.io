import { searchAdmin, money } from './quote-engine.js';

const resultsEl = document.getElementById('results');

const MODEL_LABEL = {
  standard: 'Standard',
  flat: 'Flat rate',
  haul_plus_disposal: 'Haul + Disposal',
};

function currentFilters() {
  return {
    cityRaw: document.getElementById('city').value,
    vendorRaw: document.getElementById('vendor').value,
  };
}

function rawPricingDetail(row) {
  if (row.pricingModel === 'haul_plus_disposal') {
    return `<div>Haul rate: <b>${money(row.haulRate)}</b></div><div>Per ton: <b>${money(row.perTon)}</b></div>`;
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
    card.innerHTML = `
      <div class="result-top">
        <div>
          <div class="result-size">${row.size} yd</div>
          <div class="result-vendor">${row.vendor}${row.phone ? ' · ' + row.phone : ''}</div>
          <div class="result-city-note">${row.city}, ${row.state} · ${MODEL_LABEL[row.pricingModel] || row.pricingModel}</div>
        </div>
        <div class="result-total">${money(price.total)}</div>
      </div>
      <div class="admin-detail">
        ${rawPricingDetail(row)}
        <div>Rental days on file: <b>${row.rentalDays ?? '\u2014'}</b></div>
        <div>Delivery fee: <b>${money(row.delivery || 0)}</b></div>
        <div>Fuel surcharge: <b>${money(row.fuelSurcharge || 0)}</b></div>
        <div>Ton overage (raw): <b>${row.tonOverageRate != null ? money(row.tonOverageRate) + '/ton' : '\u2014'}</b></div>
        <div>Day overage (raw): <b>${row.dayOverageRate != null ? money(row.dayOverageRate) + '/day' : '\u2014'}</b></div>
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
