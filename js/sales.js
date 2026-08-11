import { VENDORS, DEBRIS_TYPES, SIZES } from './data.js';
import { getQuotes, vendorName, debrisNames, money } from './quote-engine.js';

const debrisSelect = document.getElementById('debris');
DEBRIS_TYPES.forEach(d => {
  const opt = document.createElement('option');
  opt.value = d.id;
  opt.textContent = d.name;
  debrisSelect.appendChild(opt);
});

const resultsEl = document.getElementById('results');

function currentFilters() {
  return {
    locationRaw: document.getElementById('location').value,
    size: document.getElementById('size').value,
    debrisId: document.getElementById('debris').value,
    tons: parseFloat(document.getElementById('tons').value) || 0,
    addons: {
      delivery: parseFloat(document.getElementById('delivery').value) || 0,
      fuel: parseFloat(document.getElementById('fuel').value) || 0,
      overage: parseFloat(document.getElementById('overage').value) || 0,
    },
  };
}

function render(data) {
  resultsEl.innerHTML = '';

  if (!data.hasLocation) {
    resultsEl.innerHTML = `<div class="empty-state">Enter a zip or city/state above, then get pricing — a location narrows this down to real matches.</div>`;
    return;
  }

  if (!data.results.length) {
    resultsEl.innerHTML = `<div class="empty-state">No vendors match that combination yet. Try "Any" for size or debris type to widen the search.</div>`;
    return;
  }

  const tierNote = data.tier !== 'city'
    ? `<span class="badge">Estimate · unconfirmed vendor</span>`
    : '';
  const tierLine = document.createElement('div');
  tierLine.className = 'match-tier';
  tierLine.innerHTML = `Matched at: <strong style="color:var(--text)">${data.tierLabel}</strong> ${tierNote}`;
  resultsEl.appendChild(tierLine);

  data.results.forEach(({ row, price }) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const totalDisplay = price.isEstimate
      ? `${money(price.total)} <span class="range">– ${money(price.totalHigh)}</span>`
      : money(price.total);

    card.innerHTML = `
      <div class="result-top">
        <div>
          <div class="result-size">${row.size} yd</div>
          <div class="result-debris">${debrisNames(row.debrisTypeIds, DEBRIS_TYPES)}</div>
        </div>
        <div class="result-total">${totalDisplay}</div>
      </div>
      <details class="breakdown">
        <summary>Price breakdown</summary>
        <div class="breakdown-rows">
          ${price.costNote ? `<div class="breakdown-row"><span>${price.costNote}</span><span></span></div>` : ''}
          <div class="breakdown-row"><span>Base (cost ÷ 0.74)</span><span>${money(price.quote - price.addonsTotal)}</span></div>
          ${price.addonsTotal ? `<div class="breakdown-row"><span>Add-ons</span><span>${money(price.addonsTotal)}</span></div>` : ''}
          ${price.tax ? `<div class="breakdown-row"><span>Tax</span><span>${money(price.tax)}</span></div>` : ''}
          <div class="breakdown-row total"><span>Total</span><span>${totalDisplay}</span></div>
        </div>
      </details>
    `;
    resultsEl.appendChild(card);
  });
}

document.getElementById('search-btn').addEventListener('click', () => {
  render(getQuotes(currentFilters()));
});

// Allow Enter key from the location field to trigger a search.
document.getElementById('location').addEventListener('keydown', e => {
  if (e.key === 'Enter') render(getQuotes(currentFilters()));
});
