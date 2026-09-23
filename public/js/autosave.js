// Makes any <form class="autosave-form"> on the page save itself in the
// background as soon as a field is changed, instead of waiting for someone
// to click a Save button. A visible Save/Update button is still kept on
// every one of these forms as a manual fallback (and it still works exactly
// as before - a normal full-page submit) in case JavaScript ever fails to
// load, or someone just wants to be sure.
//
// Text/textarea/number/date fields save shortly after you stop typing, or
// as soon as you click away (whichever comes first). Selects, checkboxes
// and radio buttons save the instant you change them. File pickers are left
// alone - choosing a file still needs its own Upload/Save button, since
// picking the wrong file by mistake should never happen silently.
//
// A page can react to what an autosave just did (e.g. the Update Status
// form updates the status pill and history list without a reload) by
// registering a function on window.autosaveHandlers, keyed by whatever name
// is set as that form's data-autosave-handler attribute.
(function () {
  function debounce(fn, wait) {
    let timer;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function getIndicator(form) {
    let el = form.querySelector(':scope > .autosave-indicator, .autosave-indicator');
    if (el) return el;
    el = document.createElement('span');
    el.className = 'autosave-indicator';
    const btn = form.querySelector('button[type="submit"]');
    if (btn && btn.parentNode) {
      btn.insertAdjacentElement('afterend', el);
    } else {
      form.appendChild(el);
    }
    return el;
  }

  function showIndicator(form, text, isError) {
    const el = getIndicator(form);
    el.textContent = text;
    el.classList.toggle('autosave-indicator-error', !!isError);
    el.classList.add('autosave-indicator-visible');
    clearTimeout(el._fadeTimer);
    el._fadeTimer = setTimeout(() => {
      el.classList.remove('autosave-indicator-visible');
    }, isError ? 6000 : 2500);
  }

  async function submitForm(form) {
    showIndicator(form, 'Saving…');
    let res;
    try {
      res = await fetch(form.getAttribute('action'), {
        method: (form.getAttribute('method') || 'POST').toUpperCase(),
        body: new FormData(form),
        headers: { 'X-Autosave': '1' },
        credentials: 'same-origin'
      });
    } catch (err) {
      showIndicator(form, 'Could not save - check your connection.', true);
      return;
    }

    let data = null;
    try { data = await res.json(); } catch (err) { /* not JSON - ignore */ }

    if (!res.ok || !data || data.ok === false) {
      showIndicator(form, (data && data.error) ? data.error : 'Could not save - check your connection.', true);
      return;
    }

    showIndicator(form, 'Saved \u2713');

    const savedLine = form.querySelector('.autosave-lastsaved');
    if (savedLine && data.savedBy && data.savedAt) {
      savedLine.textContent = 'Last saved by ' + data.savedBy + ' on ' + new Date(data.savedAt).toLocaleString('en-GB');
    }

    const handlerName = form.dataset.autosaveHandler;
    if (handlerName && window.autosaveHandlers && typeof window.autosaveHandlers[handlerName] === 'function') {
      window.autosaveHandlers[handlerName](form, data);
    }
  }

  function wireForm(form) {
    const debouncedSubmit = debounce(() => submitForm(form), 900);
    form.querySelectorAll('input, select, textarea').forEach((field) => {
      if (field.type === 'submit' || field.type === 'button' || field.type === 'file') return;
      if (field.tagName === 'SELECT' || field.type === 'checkbox' || field.type === 'radio') {
        field.addEventListener('change', () => submitForm(form));
      } else {
        field.addEventListener('input', debouncedSubmit);
        field.addEventListener('blur', () => submitForm(form));
      }
    });
  }

  document.querySelectorAll('form.autosave-form').forEach(wireForm);
})();
