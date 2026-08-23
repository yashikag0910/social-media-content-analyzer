/**
 * The source map: the rendered document with every extracted line boxed over
 * it, linked both ways to the text pane.
 *
 * The point is to make extraction auditable. A reader can see exactly which
 * region produced which line, and — on OCR — which words the engine was unsure
 * about, instead of having to trust a wall of text that may quietly contain a
 * misread digit.
 *
 * Boxes are positioned in percentages of the page's intrinsic pixel size, so
 * the overlay stays aligned at any rendered width without recalculation.
 */
import { LOW_CONFIDENCE } from '../extract/ocr.js';

export function createSourceMap({ barElement, viewElement, legendElement, onSelect }) {
  let entries = [];
  let pageImages = [];
  let activePage = 1;

  function pagesWithBoxes() {
    return pageImages.filter((image) =>
      entries.some((entry) => entry.page === image.page && entry.box)
    );
  }

  function renderPageBar() {
    const pages = pageImages.map((image) => image.page);
    barElement.hidden = pages.length < 2;
    if (pages.length < 2) return;

    barElement.innerHTML = pages
      .map(
        (page) =>
          `<button type="button" class="pagebar__btn" data-page="${page}"
             aria-pressed="${page === activePage}">Page ${page}</button>`
      )
      .join('');
  }

  function boxStyle(box, image) {
    const pct = (value, total) => `${((value / total) * 100).toFixed(3)}%`;
    return (
      `left:${pct(box.x, image.width)};top:${pct(box.y, image.height)};` +
      `width:${pct(box.w, image.width)};height:${pct(box.h, image.height)}`
    );
  }

  function renderPage() {
    const image = pageImages.find((candidate) => candidate.page === activePage);
    if (!image) {
      viewElement.innerHTML = '<p class="pageview__empty">No page preview available.</p>';
      return;
    }

    const boxes = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.page === activePage && entry.box)
      .map(({ entry, index }) => {
        // Word-level boxes are drawn only where OCR was unsure, so the overlay
        // stays readable and the doubtful words are the thing that stands out.
        const doubtful = (entry.words ?? [])
          .filter((word) => word.confidence < LOW_CONFIDENCE)
          .map(
            (word) =>
              `<i class="wordbox" style="${boxStyle(word.box, image)}"
                  title="“${escapeAttribute(word.text)}” — ${Math.round(word.confidence)}% confidence"></i>`
          )
          .join('');

        return (
          `<button type="button" class="linebox" data-index="${index}"
             style="${boxStyle(entry.box, image)}"
             title="${escapeAttribute(entry.text)}"
             aria-label="Extracted line: ${escapeAttribute(entry.text)}"></button>${doubtful}`
        );
      })
      .join('');

    viewElement.innerHTML = `
      <div class="pageview__frame" style="aspect-ratio:${image.width} / ${image.height}">
        <img class="pageview__img" src="${image.src}" alt="Page ${activePage} of the uploaded document" />
        <div class="pageview__overlay">${boxes}</div>
      </div>`;
  }

  barElement.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) return;
    activePage = Number(button.dataset.page);
    renderPageBar();
    renderPage();
  });

  for (const type of ['mouseover', 'focusin']) {
    viewElement.addEventListener(type, (event) => {
      const box = event.target.closest('[data-index]');
      if (box) onSelect(Number(box.dataset.index), type === 'focusin');
    });
  }

  viewElement.addEventListener('click', (event) => {
    const box = event.target.closest('[data-index]');
    if (box) onSelect(Number(box.dataset.index), true);
  });

  return {
    /** @param {{entries: Array<object>, pageImages: Array<object>}} result */
    render(result) {
      entries = result.entries ?? [];
      pageImages = result.pageImages ?? [];
      // Drop preview pages that produced no text: an empty page with an empty
      // overlay is a tab that does nothing when clicked.
      pageImages = pagesWithBoxes();
      activePage = pageImages[0]?.page ?? 1;
      renderPageBar();
      renderPage();

      const hasConfidence = entries.some((entry) => (entry.words ?? []).length > 0);
      legendElement.hidden = !hasConfidence;
    },

    /** Move the overlay to whichever page owns this entry, then flag it. */
    focus(index) {
      const entry = entries[index];
      if (!entry) return;
      if (entry.page !== activePage) {
        activePage = entry.page;
        renderPageBar();
        renderPage();
      }
      viewElement.querySelectorAll('.linebox--active').forEach((box) => {
        box.classList.remove('linebox--active');
      });
      const box = viewElement.querySelector(`[data-index="${index}"]`);
      if (box) {
        box.classList.add('linebox--active');
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    },

    clear() {
      entries = [];
      pageImages = [];
      viewElement.innerHTML = '';
      barElement.hidden = true;
      legendElement.hidden = true;
    },
  };
}

function escapeAttribute(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
}
