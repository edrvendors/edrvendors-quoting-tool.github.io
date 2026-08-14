// Powers both add-vendor.html and update-vendor.html.
// Any <form data-vendor-form> on the page gets wired up the same way:
// submit via fetch so the person never leaves the site, show an inline
// success state on success, show a small error message and let them retry
// on failure.

const form = document.querySelector('form[data-vendor-form]');

if (form) {
  // Linked from Sales' "no vendor for this area" prompt as
  // add-vendor.html?area=City,%20ST — prefill the Notes field so whoever
  // fills this out doesn't have to retype the location.
  const areaParam = new URLSearchParams(location.search).get('area');
  const notesEl = form.querySelector('textarea[name="Notes"]');
  if (areaParam && notesEl && !notesEl.value) {
    notesEl.value = `Area needed: ${areaParam}\n`;
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
