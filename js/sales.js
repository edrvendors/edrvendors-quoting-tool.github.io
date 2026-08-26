import { DEBRIS_TYPES } from './data.js';
import { getQuotes, priceRule, money, citySuggestions } from './quote-engine.js';

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
  if (price.isFlat) {
    parts.push('Flat rate — all tonnage included');
  } else if (price.tons != null) {
    parts.push(`Includes ${price.tons} ton${price.tons === 1 ? '' : 's'}`);
  }
  parts.push(price.rentalDays != null ? `${price.rentalDays} day rental` : 'Rental period: confirm with vendor');
  return parts.join(' · ');
}

function overageLine(price) {
  const parts = [];
  if (price.tonOverage === 0) {
    parts.push('No extra charge for tonnage — included in the price');
  } else if (price.tonOverage != null) {
    parts.push(`Extra ton: ${money(price.tonOverage)}`);
  }
  if (price.dayOverage != null) {
    parts.push(price.dayOverageIsProrated
      ? `Extra day: ~${money(price.dayOverage)} <span class="prorated-note">(vendor bills weekly — daily estimate)</span>`
      : `Extra day: ${money(price.dayOverage)}`);
  }
  return parts.join(' &nbsp;&nbsp; ');
}

function debrisBadge(debrisType) {
  if (!debrisType) return '';
  const name = DEBRIS_NAME[debrisType] || debrisType;
  return `<span class="badge badge--debris">${name}</span>`;
}

/** Fallback distinguishing label for a grouped card when variants don't
 *  differ by debris type -- e.g. a vendor with more than one internal
 *  pricing zone covering the same city name. Without some label, two
 *  identically-priced-looking lines with no explanation is worse than
 *  showing the vendor's own zone reference. */
function variantLabel(row) {
  if (row.debrisType) return debrisBadge(row.debrisType);
  if (row.zoneLabel) return `<span class="badge badge--debris">${row.zoneLabel}</span>`;
  return '';
}

function addVendorLink(city, state) {
  const area = [city, state].filter(Boolean).join(', ');
  const href = area ? `add-vendor.html?area=${encodeURIComponent(area)}` : 'add-vendor.html';
  return `<a class="text-link" href="${href}">+ Add a vendor for this area</a>`;
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Plain-text block a rep can paste straight into a customer email or
 *  text -- price, tonnage/rental period, overage, vendor + phone. */
function buildCopyText(row, price) {
  const lines = [`${row.size} yd \u2014 ${money(price.total)}`];
  lines.push(stripHtml(detailLine(row, price)));
  const overage = overageLine(price);
  if (overage) lines.push(stripHtml(overage));
  if (row.vendor) lines.push(`${row.vendor}${row.phone ? ' \u00b7 ' + row.phone : ''}`);
  return lines.join('\n');
}

function flagPriceHref(row) {
  const params = new URLSearchParams();
  if (row.vendor) params.set('vendor', row.vendor);
  if (row.city) params.set('city', row.city);
  if (row.state) params.set('state', row.state);
  if (row.size != null) params.set('size', row.size);
  return `update-vendor.html?${params.toString()}`;
}

function cardActionsHtml() {
  return `
    <div class="card-actions">
      <button type="button" class="icon-btn" data-copy-btn>Copy for email</button>
      <a class="flag-link" data-flag-link target="_blank" rel="noopener">Something look off? Flag this price</a>
    </div>
  `;
}

/** Wires the actions row built by cardActionsHtml(). getPrice is a
 *  function (not a static value) so the Haul + Disposal tonnage stepper
 *  can keep the copy button in sync with whatever's currently on screen. */
function wireCardActions(el, row, getPrice) {
  const flagEl = el.querySelector('[data-flag-link]');
  if (flagEl) flagEl.href = flagPriceHref(row);
  const copyBtn = el.querySelector('[data-copy-btn]');
  if (!copyBtn) return;
  const originalLabel = copyBtn.textContent;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(buildCopyText(row, getPrice())).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = originalLabel; }, 1500);
    }).catch(() => {
      copyBtn.textContent = 'Copy failed \u2014 select manually';
      setTimeout(() => { copyBtn.textContent = originalLabel; }, 2000);
    });
  });
}

/** Renders one priced line — a full single-vendor card body, or one
 *  variant's slice within a grouped multi-debris card. */
function buildPriceBlock(row, price, { withTotalHeader }) {
  const el = document.createElement('div');
  el.className = 'price-block';
  const overage = overageLine(price);
  let currentPrice = price;

  const totalHeader = withTotalHeader ? `
    <div class="price-block__top">
      ${variantLabel(row)}
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
    ${cardActionsHtml()}
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
        currentPrice = newPrice;
        if (totalEl) totalEl.textContent = money(newPrice.total);
        detailEl.textContent = detailLine(row, newPrice);
        tonsDisplayEl.textContent = `${tons} ton${tons === 1 ? '' : 's'}`;
      });
    });
  }

  wireCardActions(el, row, () => currentPrice);

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
    let currentPrice = price;
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
      ${cardActionsHtml()}
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
          currentPrice = newPrice;
          totalEl.textContent = money(newPrice.total);
          detailEl.textContent = detailLine(row, newPrice);
          tonsDisplayEl.textContent = `${tons} ton${tons === 1 ? '' : 's'}`;
        });
      });
    }
    wireCardActions(card, row, () => currentPrice);
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
    <div class="variant-note">More than one price applies here — see the label on each line below, or narrow your search above for a single number.</div>
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
    const est = row.estimate;
    const priceLine = est
      ? `<div class="notice-banner__quote">Suggested quote: ${money(est.total)} <span class="notice-banner__quote-note">(${row.size} yd, ~${est.rentalDays}-day rental — quote this now, call the vendor for the real price before invoicing)</span></div>
         <div class="result-detail-row">${est.tonOverage != null ? `Extra ton (estimated): ${money(est.tonOverage)}` : 'No state-average ton rate available yet'}</div>`
      : `<div class="notice-banner__quote-note">Not enough Standard-priced vendors in ${row.state} yet to suggest a number for ${row.size} yd — call before quoting.</div>`;
    return `
      <div class="notice-banner notice-banner--must-call">
        <span class="notice-banner__label">Call for pricing</span>
        ${row.vendor}${row.phone ? ' · ' + row.phone : ''} services this area, but every job is priced individually.
        ${priceLine}
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

/** A computed state-average price, never a real vendor's price — kept
 *  visually distinct so a rep can't mistake it for an actual quote. */
function estimateCard(estimate) {
  const card = document.createElement('div');
  card.className = 'result-card result-card--estimate';
  card.innerHTML = `
    <div class="result-top">
      <div>
        <div class="result-size">${estimate.size} yd</div>
        <div class="result-vendor">Estimated price — no vendor confirmed yet</div>
      </div>
      <div class="result-total">${money(estimate.total)}</div>
    </div>
    <div class="result-detail-row">${estimate.rentalDays} day rental (typical) · based on the state average, not a specific vendor</div>
    ${estimate.tonOverage != null ? `<div class="result-detail-row">Extra ton (estimated): ${money(estimate.tonOverage)}</div>` : ''}
  `;
  return card;
}

/** Contact-only suggestion — never a price, just who might be worth a call. */
function callVendorCard(vendors, city, state) {
  const card = document.createElement('div');
  card.className = 'result-card result-card--call';
  const rows = vendors.map(v => `<div class="result-detail-row"><b>${v.vendor}</b> · ${v.phone}</div>`).join('');
  card.innerHTML = `
    <div class="result-vendor">Try calling to check if they service ${[city, state].filter(Boolean).join(', ') || 'this area'}</div>
    ${rows}
  `;
  return card;
}

/** Clickable "did you mean X?" suggestions shown when the typed city
 *  matched zero rows at all -- built with DOM methods rather than
 *  innerHTML since cityRaw is whatever the rep just typed. */
function didYouMeanBlock(suggestions, cityRaw) {
  const wrap = document.createElement('div');
  wrap.className = 'did-you-mean';
  const label = document.createElement('div');
  label.textContent = `Didn't find "${cityRaw}" — did you mean:`;
  wrap.appendChild(label);
  const chips = document.createElement('div');
  chips.className = 'did-you-mean__chips';
  suggestions.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'did-you-mean__chip';
    btn.textContent = s.states.length === 1 ? `${s.city}, ${s.states[0]}` : s.city;
    btn.addEventListener('click', () => {
      document.getElementById('city').value = s.city;
      if (s.states.length === 1) document.getElementById('state').value = s.states[0];
      render(getQuotes(currentFilters()));
    });
    chips.appendChild(btn);
  });
  wrap.appendChild(chips);
  return wrap;
}

function render(data) {
  resultsEl.innerHTML = '';
  const filters = currentFilters();

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

  if (data.didYouMean && data.didYouMean.length) {
    resultsEl.appendChild(didYouMeanBlock(data.didYouMean, filters.cityRaw));
  }

  if (data.tier === 'city') {
    data.results.forEach(entry => resultsEl.appendChild(renderCard(entry)));
    return;
  }

  // No priced vendor in the exact city — an estimate (if the state has
  // enough data to build one) plus contact-only suggestions, never
  // another city's real vendor prices standing in for this one.
  const noteEl = document.createElement('div');
  noteEl.className = 'match-tier';
  noteEl.textContent = 'No vendor on file for that exact city — showing a state-average estimate instead.';
  resultsEl.appendChild(noteEl);

  if (data.estimates && data.estimates.length) {
    data.estimates.forEach(e => resultsEl.appendChild(estimateCard(e)));
  }
  if (data.callVendors && data.callVendors.length) {
    resultsEl.appendChild(callVendorCard(data.callVendors, filters.cityRaw, filters.stateRaw));
  }
  if (!(data.estimates && data.estimates.length) && !(data.callVendors && data.callVendors.length)) {
    resultsEl.innerHTML += `<div class="empty-state">Nothing on file for that area yet. ${addVendorLink(filters.cityRaw, filters.stateRaw)}</div>`;
  } else {
    const linkEl = document.createElement('div');
    linkEl.className = 'match-tier';
    linkEl.innerHTML = addVendorLink(filters.cityRaw, filters.stateRaw);
    resultsEl.appendChild(linkEl);
  }
}

document.getElementById('search-btn').addEventListener('click', () => render(getQuotes(currentFilters())));
['zip', 'city'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') render(getQuotes(currentFilters()));
  });
});

// ---------- Typo-tolerant city search: live as-you-type dropdown ----------
const cityInput = document.getElementById('city');
const stateSelect = document.getElementById('state');
const citySuggestBox = document.getElementById('city-suggest');

function renderCitySuggestions() {
  const matches = cityInput.value.trim().length >= 2
    ? citySuggestions(cityInput.value, stateSelect.value || null, 6)
    : [];
  citySuggestBox.innerHTML = '';
  if (!matches.length) { citySuggestBox.hidden = true; return; }
  matches.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = s.states.length === 1 ? `${s.city}, ${s.states[0]}` : s.city;
    btn.addEventListener('click', () => {
      cityInput.value = s.city;
      if (s.states.length === 1) stateSelect.value = s.states[0];
      citySuggestBox.hidden = true;
      render(getQuotes(currentFilters()));
    });
    citySuggestBox.appendChild(btn);
  });
  citySuggestBox.hidden = false;
}

let suggestDebounce = null;
cityInput.addEventListener('input', () => {
  clearTimeout(suggestDebounce);
  suggestDebounce = setTimeout(renderCitySuggestions, 180);
});
cityInput.addEventListener('focus', () => {
  if (citySuggestBox.innerHTML) citySuggestBox.hidden = false;
});
cityInput.addEventListener('blur', () => {
  // Delayed so a click on a suggestion registers before the list is hidden.
  setTimeout(() => { citySuggestBox.hidden = true; }, 150);
});
