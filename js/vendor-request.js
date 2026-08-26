// Powers both add-vendor.html and update-vendor.html.
// Any <form data-vendor-form> on the page gets wired up the same way:
// submit via fetch so the person never leaves the site, show an inline
// success state on success, show a small error message and let them retry
// on failure.

const form = document.querySelector('form[data-vendor-form]');

if (form) {
  const params = new URLSearchParams(location.search);
  const notesEl = form.querySelector('textarea[name="Notes"]');

  // Linked from Sales' "no vendor for this area" prompt as
  // add-vendor.html?area=City,%20ST — prefill the Notes field so whoever
  // fills this out doesn't have to retype the location.
  const areaParam = params.get('area');
  if (areaParam && notesEl && !notesEl.value) {
    notesEl.value = `Area needed: ${areaParam}\n`;
  }

  // Linked from Sales' "Flag this price" link on a quote as
  // update-vendor.html?vendor=Name&city=City&state=ST&size=20 — prefill
  // the vendor name, note the location/size, and check "Pricing" so the
  // rep doesn't have to type any of it themselves.
  const vendorParam = params.get('vendor');
  const vendorNameEl = form.querySelector('input[name="Vendor name"]');
  if (vendorParam && vendorNameEl && !vendorNameEl.value) {
    vendorNameEl.value = vendorParam;
    const area = [params.get('city'), params.get('state')].filter(Boolean).join(', ');
    const sizeParam = params.get('size');
    if (notesEl && !notesEl.value) {
      notesEl.value = `Flagged from a sales quote${sizeParam ? ` (${sizeParam} yd)` : ''}${area ? ` in ${area}` : ''} — the price shown looked off. Please review.\n`;
    }
    const pricingCheckbox = form.querySelector('input[value="Pricing"]');
    if (pricingCheckbox) pricingCheckbox.checked = true;
  }

  const panel = form.closest('.panel');
  const submitBtn = form.querySelector('button[type="submit"]');
  const errorEl = form.querySelector('[data-form-error]');
  const successMessage = form.dataset.successMessage || 'Thanks — this has been sent through.';
  const originalLabel = submitBtn.textContent;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (errorEl) errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    fetch(form.action, {
      method: form.method,
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Formspree returned an error');
        panel.innerHTML = `
          <div class="form-success">
            <div class="form-success__title">✓ Request sent</div>
            <p>${successMessage}</p>
            <button type="button" class="btn" data-send-another>Send another</button>
          </div>
        `;
        panel.querySelector('[data-send-another]').addEventListener('click', () => location.reload());
      })
      .catch(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        if (errorEl) errorEl.hidden = false;
      });
  });
}
