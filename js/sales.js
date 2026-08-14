import { DEBRIS_TYPES } from './data.js';
import { getQuotes, priceRule, money } from './quote-engine.js';

const debrisSelect = document.getElementById('debris');
DEBRIS_TYPES.forEach(d => {
  const opt = document.createElement('option');
  opt.value = d.id;
  opt.textContent = d.name;
  debrisSelect.appendChild(opt);
});

const resultsEl = document.getElementById('results');
let lastLocation = { city: '', state: '' };

function currentFilters() {
  return {
    zipRaw: document.getElementById('zip').value,
    cityRaw: document.getElementById('city').value,
    stateRaw: document.getElementById('state').value,
    size: document.getElementById('size').value,
    debrisId: document.getElementById('debris').value,
  };
}

function detailLine(row, price) {
  const parts = [];
  if (!price.isFlat && price.tons != null) parts.push(`Includes ${price.tons} ton${price.tons === 1 ? '' : 's'}`);
  parts.push(price.rentalDays != null ? `${price.rentalDays} day rental` : 'Rental period: confirm with vendor');
  return parts.join(' · ');
}

function overageLine(price) {
  const parts = [];
  if (price.tonOverage != null) parts.push(`Extra ton: ${money(price.tonOverage)}`);
  if (price.dayOverage != null) parts.push(`Extra day: ${money(price.dayOverage)}`);
  return parts.join(' &nbsp;&nbsp; ');
}

function renderCard(row, price) {
  const card = document.createElement('div');
  card.className = 'result-card';

  const cityNote = row.city ? `<div class="result-city-note">${row.city}, ${row.state}</div>` : '';
  const overage = overageLine(price);

  card.innerHTML = `
    <div class="result-top">
      <div>
        <div class="result-size">${row.size} yd</div>
        <div class="result-vendor">${row.vendor}${row.phone ? ' · ' + row.phone : ''}</div>
        ${cityNote}
      </div>
      <div class="result-total" data-total>${money(price.total)}</div>
    </div>
    <div class="result-detail-row" data-detail>${detailLine(row, price)}</div>
    ${overage ? `<div class="result-detail-row">${overage}</div>` : ''}
    ${price.isHaulPlusDisposal ? `
      <div class="adjuster">
        <span class="badge badge--info">Haul + Disposal — adjustable</span>
        <div class="stepper">
          <button type="button" data-action="minus" aria-label="Fewer tons">−</button>
          <span data-tons-display>${price.tons} ton${price.tons === 1 ? '' : 's'}</span>
          <button type="button" data-action="plus" aria-label="More tons">+</button>
        </div>
      </div>
    ` : ''}
  `;

  if (price.isHaulPlusDisposal) {
    let tons = price.tons;
    const totalEl = card.querySelector('[data-total]');
    const detailEl = card.querySelector('[data-detail]');
    const tonsDisplayEl = card.querySelector('[data-tons-display]');
    card.querySelectorAll('.stepper button').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = btn.dataset.action === 'plus' ? 1 : -1;
        tons = Math.max(0, tons + delta);
        const newPrice = priceRule(row, tons);
        totalEl.textContent = money(newPrice.total);
        detailEl.textContent = detailLine(row, newPrice);
        tonsDisplayEl.textContent = `${tons} ton${tons === 1 ? '' : 's'}`;
      });
    });
  }

  return card;
}

function estimateDetailLine(est) {
  const parts = [`Includes ${est.tons} ton${est.tons === 1 ? '' : 's'}`, `${est.rentalDays} day rental`];
  return parts.join(' · ');
}

function estimateOverageLine(est) {
  const parts = [];
  if (est.tonOverage != null) parts.push(`Extra ton: ${money(est.tonOverage)}`);
  if (est.dayOverage != null) parts.push(`Extra day: ${money(est.dayOverage)}`);
  return parts.join(' &nbsp;&nbsp; ');
}

function renderEstimateCard(est) {
  const card = document.createElement('div');
  card.className = 'result-card result-card--estimate';
  const overage = estimateOverageLine(est);

  card.innerHTML = `
    <div class="result-top">
      <div>
        <div class="result-size">${est.size} yd</div>
        <div class="result-vendor result-vendor--estimate">Estimated price</div>
      </div>
      <div class="result-total">${money(est.total)}</div>
    </div>
    <div class="result-detail-row">${estimateDetailLine(est)}</div>
    ${overage ? `<div class="result-detail-row">${overage}</div>` : ''}
  `;
  return card;
}

function renderAddVendorPrompt(context = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'add-vendor-prompt';
  const area = [context.city, context.state].filter(Boolean).join(', ')
    || (context.zip ? `zip ${context.zip}` : 'this area');
  const params = new URLSearchParams();
  if (area && area !== 'this area') params.set('area', area);
  const href = `add-vendor.html${params.toString() ? '?' + params.toString() : ''}`;

  wrap.innerHTML = `
    <p>Know a vendor that services ${area}?</p>
    <a class="btn" href="${href}">Add a vendor →</a>
  `;
  return wrap;
}

function render(data) {
  resultsEl.innerHTML = '';

  if (!data.hasLocation) {
    resultsEl.innerHTML = `<div class="empty-state">Enter a zip or city/state above, then get pricing.</div>`;
    return;
  }

  if (data.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'match-tier';
    noteEl.textContent = data.note;
    resultsEl.appendChild(noteEl);
  }

  if (data.tier === 'suggested') {
    const noteEl = document.createElement('div');
    noteEl.className = 'match-tier';
    noteEl.innerHTML = `<span class="badge">Estimated</span> No confirmed vendor for this area — here's a price to work with.`;
    resultsEl.appendChild(noteEl);
    data.suggested.forEach(est => resultsEl.appendChild(renderEstimateCard(est)));
    resultsEl.appendChild(renderAddVendorPrompt(data.addVendorContext));
    return;
  }

  if (!data.results.length) {
    resultsEl.innerHTML += `<div class="empty-state">No vendors found for that area yet, and not enough data on file to estimate a price.</div>`;
    if (data.addVendorPrompt) resultsEl.appendChild(renderAddVendorPrompt(data.addVendorContext));
    return;
  }

  data.results.forEach(({ row, price }) => resultsEl.appendChild(renderCard(row, price)));
}

document.getElementById('search-btn').addEventListener('click', () => render(getQuotes(currentFilters())));
['zip', 'city'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') render(getQuotes(currentFilters()));
  });
});
