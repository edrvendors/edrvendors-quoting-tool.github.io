import { DEBRIS_TYPES } from './data.js';
import { getQuotes, priceRule, money } from './quote-engine.js';

const DEBRIS_NAME = Object.fromEntries(DEBRIS_TYPES.map(d => [d.id, d.name]));

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

function debrisBadge(debrisType) {
  if (!debrisType) return '';
  const name = DEBRIS_NAME[debrisType] || debrisType;
  return `<span class="badge badge--debris">${name}</span>`;
}

/** Renders one priced line — a full single-vendor card body, or one
 *  variant's slice within a grouped multi-debris card. */
function buildPriceBlock(row, price, { withTotalHeader }) {
  const el = document.createElement('div');
  el.className = 'price-block';
  const overage = overageLine(price);

  const totalHeader = withTotalHeader ? `
    <div class="price-block__top">
      ${debrisBadge(row.debrisType)}
      <div class="result-total" data-total>${money(price.total)}</div>
    </div>
  ` : '';

  el.innerHTML = `
    ${totalHeader}
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
    const totalEl = el.querySelector('[data-total]');
    const detailEl = el.querySelector('[data-detail]');
    const tonsDisplayEl = el.querySelector('[data-tons-display]');
    el.querySelectorAll('.stepper button').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = btn.dataset.action === 'plus' ? 1 : -1;
        tons = Math.max(0, tons + delta);
        const newPrice = priceRule(row, tons);
        if (totalEl) totalEl.textContent = money(newPrice.total);
        detailEl.textContent = detailLine(row, newPrice);
        tonsDisplayEl.textContent = `${tons} ton${tons === 1 ? '' : 's'}`;
      });
    });
  }

  return el;
}

/** entry is either { single: {row, price} } or { variants: [{row, price}, ...] } */
function renderCard(entry) {
  const card = document.createElement('div');
  card.className = 'result-card';
  const headRow = entry.single ? entry.single.row : entry.variants[0].row;
  const cityNote = headRow.city ? `<div class="result-city-note">${headRow.city}, ${headRow.state}</div>` : '';

  if (entry.single) {
    const { row, price } = entry.single;
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
      ${overageLine(price) ? `<div class="result-detail-row">${overageLine(price)}</div>` : ''}
      ${row.debrisType ? `<div class="result-detail-row">${debrisBadge(row.debrisType)}</div>` : ''}
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

  // Grouped: multiple debris variants of the same vendor+city+size —
  // one header, one labeled price block per variant.
  card.innerHTML = `
    <div class="result-top">
      <div>
        <div class="result-size">${headRow.size} yd</div>
        <div class="result-vendor">${headRow.vendor}${headRow.phone ? ' · ' + headRow.phone : ''}</div>
        ${cityNote}
      </div>
    </div>
    <div class="variant-note">Pricing depends on debris type — select one above for a single price, or use what fits below.</div>
  `;
  const variantsWrap = document.createElement('div');
  variantsWrap.className = 'variant-wrap';
  entry.variants.forEach(({ row, price }) => {
    variantsWrap.appendChild(buildPriceBlock(row, price, { withTotalHeader: true }));
  });
  card.appendChild(variantsWrap);
  return card;
}

function noticeBanner(row) {
  if (row.pricingModel === 'must_call_for_pricing') {
    return `
      <div class="notice-banner notice-banner--must-call">
        <span class="notice-banner__label">Call for pricing</span>
        ${row.vendor}${row.phone ? ' · ' + row.phone : ''} services this area, but every job is priced individually.
        If you get the sale, call them directly for the actual price before confirming with the customer.
      </div>`;
  }
  if (row.pricingModel === 'franchised') {
    return `
      <div class="notice-banner notice-banner--franchised">
        <span class="notice-banner__label">Franchised city</span>
        ${row.city}, ${row.state} is under an exclusive franchise agreement. We are not able to service this job.
      </div>`;
  }
  return '';
}

function render(data) {
  resultsEl.innerHTML = '';

  if (!data.hasLocation) {
    resultsEl.innerHTML = `<div class="empty-state">Enter a zip or city/state above, then get pricing.</div>`;
    return;
  }

  (data.cityNotices || []).forEach(row => { resultsEl.innerHTML += noticeBanner(row); });

  if (data.note) {
    const noteEl = document.createElement('div');
    noteEl.className = 'match-tier';
    noteEl.textContent = data.note;
    resultsEl.appendChild(noteEl);
  }

  if (!data.results.length) {
    resultsEl.innerHTML += `<div class="empty-state">No vendors found for that area yet in the sample data.</div>`;
    return;
  }

  if (data.tier !== 'city') {
    const noteEl = document.createElement('div');
    noteEl.className = 'match-tier';
    noteEl.textContent = 'No exact match for that city — showing the closest vendors available in the area.';
    resultsEl.appendChild(noteEl);
  }

  data.results.forEach(entry => resultsEl.appendChild(renderCard(entry)));
}

document.getElementById('search-btn').addEventListener('click', () => render(getQuotes(currentFilters())));
['zip', 'city'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') render(getQuotes(currentFilters()));
  });
});
