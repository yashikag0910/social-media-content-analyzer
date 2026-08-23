/**
 * The single live region that carries every loading, progress and error state.
 * Centralised so there is exactly one place that can be out of sync with what
 * the app is actually doing.
 */
export function createStatus(element) {
  let current = null;

  function paint(kind, html) {
    element.hidden = false;
    element.dataset.kind = kind;
    element.innerHTML = html;
  }

  return {
    /** Indeterminate work, before any progress is known. */
    busy(message) {
      current = 'busy';
      paint(
        'busy',
        `<span class="spinner" aria-hidden="true"></span>
         <span class="status__text">${escapeHtml(message)}</span>`
      );
    },

    /** Determinate progress, 0–1. */
    progress({ phase, ratio, detail }) {
      current = 'busy';
      const percent = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
      paint(
        'busy',
        `<span class="spinner" aria-hidden="true"></span>
         <span class="status__text">
           ${escapeHtml(phase)}${detail ? ` · ${escapeHtml(detail)}` : ''}
         </span>
         <span class="status__bar"><span class="status__fill" style="width:${percent}%"></span></span>
         <span class="status__percent">${percent}%</span>`
      );
    },

    success(message) {
      current = 'success';
      paint('success', `<span class="status__text">${escapeHtml(message)}</span>`);
    },

    error(message) {
      current = 'error';
      paint(
        'error',
        `<strong class="status__text">Something went wrong.</strong>
         <span class="status__text">${escapeHtml(message)}</span>`
      );
    },

    clear() {
      current = null;
      element.hidden = true;
      element.innerHTML = '';
    },

    get state() {
      return current;
    },
  };
}

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}
