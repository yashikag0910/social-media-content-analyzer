/**
 * Renders extraction output and analysis results into the DOM.
 */
import { escapeHtml } from './status.js';
import { formatBytes } from '../extract/index.js';
import { LOW_CONFIDENCE } from '../extract/ocr.js';

const SEVERITY_LABEL = { high: 'High impact', medium: 'Worth fixing', low: 'Polish' };

export function renderExtraction({ metaElement, textElement }, { file, result }) {
  const entries = [
    ['File', file.name],
    ['Size', formatBytes(file.size)],
    ['Method', result.method],
    ['Pages', String(result.pages)],
    ['Characters', result.text.length.toLocaleString()],
  ];
  if (typeof result.confidence === 'number' && result.confidence > 0) {
    entries.push(['OCR confidence', `${Math.round(result.confidence)}%`]);
  }

  metaElement.innerHTML = entries
    .map(
      ([term, value]) =>
        `<div class="meta__item"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )
    .join('');

  renderLines(textElement, result);
}

/**
 * Render the extracted text as individually addressable lines rather than one
 * text blob, so each one can be linked to its region in the source map.
 */
function renderLines(textElement, result) {
  const entries = result.entries ?? [];
  textElement.classList.toggle('extracted--empty', result.text.length === 0);

  if (result.text.length === 0) {
    textElement.innerHTML =
      '<p class="extracted__empty">No readable text was found in this file. ' +
      'If it is a photo, try a sharper, better-lit image.</p>';
    return;
  }

  textElement.innerHTML = entries
    .map((entry, index) => {
      const doubtful = (entry.words ?? []).filter((word) => word.confidence < LOW_CONFIDENCE);
      const flag = doubtful.length
        ? `<span class="line__flag" title="${escapeHtml(
            `${doubtful.length} low-confidence word(s): ${doubtful.map((word) => word.text).join(', ')}`
          )}">${doubtful.length}</span>`
        : '';
      return (
        `${entry.blankBefore && index > 0 ? '<span class="line line--blank"></span>' : ''}` +
        `<span class="line" data-index="${index}" tabindex="0" role="button"` +
        ` aria-label="Show where this line came from">` +
        `${escapeHtml(' '.repeat(entry.indent ?? 0) + entry.text)}${flag}</span>`
      );
    })
    .join('');
}

/** Highlight one line and bring it into view. */
export function focusLine(textElement, index) {
  textElement.querySelectorAll('.line--active').forEach((line) => {
    line.classList.remove('line--active');
  });
  const line = textElement.querySelector(`.line[data-index="${index}"]`);
  if (!line) return;
  line.classList.add('line--active');
  line.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const EDIT_KIND_LABEL = {
  mechanical: 'Applied automatically',
  added: 'New copy — replace it',
};

/**
 * Render the improved draft: the score it now earns, what changed and why, and
 * the draft itself.
 */
export function renderRewrite(element, result) {
  if (!result || (!result.changed && result.edits.length === 0)) {
    element.innerHTML =
      '<p class="rewrite__none">Nothing to rewrite — every mechanical fix this engine ' +
      'knows about is already applied in the original. The remaining suggestions above ' +
      'need your judgement, not a transform.</p>';
    return;
  }

  const delta = result.after - result.before;
  const tone = delta > 0 ? 'good' : delta < 0 ? 'bad' : 'warn';

  element.innerHTML = `
    <div class="delta">
      <span class="delta__score">${result.before}</span>
      <span class="delta__arrow" aria-hidden="true">→</span>
      <span class="delta__score delta__score--after" data-tone="${tone}">${result.after}</span>
      <span class="delta__label">
        ${delta > 0 ? `+${delta} points` : delta < 0 ? `${delta} points` : 'no score change'}
        after ${result.edits.length} edit(s)
      </span>
    </div>

    <ul class="edits">
      ${result.edits
        .map(
          (edit) => `
        <li class="edit" data-kind="${edit.kind}">
          <div class="edit__head">
            <span class="edit__label">${escapeHtml(edit.label)}</span>
            <span class="edit__kind">${EDIT_KIND_LABEL[edit.kind]}</span>
          </div>
          <p class="edit__detail">${escapeHtml(edit.detail)}</p>
        </li>`
        )
        .join('')}
    </ul>

    <pre class="draft" id="draft-text">${escapeHtml(result.text)}</pre>`;
}

export function renderAnalysis({ scoreElement, metricsElement, suggestionsElement }, analysis) {
  if (analysis.empty) {
    scoreElement.innerHTML =
      '<p class="score__empty">There is no text to analyse yet.</p>';
    metricsElement.innerHTML = '';
    suggestionsElement.innerHTML = '';
    return;
  }

  const { score, band, platform, metrics } = analysis;
  // Circumference of the r=52 ring below, used to drive the stroke dash offset.
  const circumference = 2 * Math.PI * 52;
  const offset = circumference * (1 - score / 100);

  scoreElement.innerHTML = `
    <svg class="score__ring" viewBox="0 0 120 120" role="img"
         aria-label="Engagement score ${score} out of 100">
      <circle class="score__track" cx="60" cy="60" r="52" />
      <circle class="score__value" data-tone="${band.tone}" cx="60" cy="60" r="52"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${offset.toFixed(1)}" />
      <text class="score__number" x="60" y="60">${score}</text>
      <text class="score__unit" x="60" y="78">/ 100</text>
    </svg>
    <div class="score__summary">
      <p class="score__band" data-tone="${band.tone}">${escapeHtml(band.label)}</p>
      <p class="score__context">
        Scored for <strong>${escapeHtml(platform.name)}</strong>.
        ${escapeHtml(platform.notes)}
      </p>
      <p class="score__context">
        ${analysis.suggestions.length} suggestion(s) ·
        ${analysis.strengths.length} thing(s) already working.
      </p>
    </div>`;

  const chips = [
    ['Words', metrics.wordCount],
    ['Characters', metrics.chars],
    ['Sentences', metrics.sentenceCount],
    ['Reading ease', Math.round(metrics.readability)],
    ['Hashtags', metrics.hashtags.length],
    ['Emoji', metrics.emojis.length],
    ['Links', metrics.urls.length],
    ['Questions', metrics.questionCount],
  ];
  metricsElement.innerHTML = chips
    .map(
      ([label, value]) =>
        `<li class="metric"><span class="metric__value">${escapeHtml(value)}</span>
         <span class="metric__label">${escapeHtml(label)}</span></li>`
    )
    .join('');

  const cards = [
    ...analysis.suggestions.map(
      (rule) => `
      <li class="suggestion" data-severity="${rule.severity}">
        <div class="suggestion__head">
          <span class="suggestion__label">${escapeHtml(rule.label)}</span>
          <span class="suggestion__severity">${SEVERITY_LABEL[rule.severity]}</span>
        </div>
        <p class="suggestion__headline">${escapeHtml(rule.headline)}</p>
        <p class="suggestion__fix">${escapeHtml(rule.fix)}</p>
      </li>`
    ),
    ...analysis.strengths.map(
      (rule) => `
      <li class="suggestion" data-severity="pass">
        <div class="suggestion__head">
          <span class="suggestion__label">${escapeHtml(rule.label)}</span>
          <span class="suggestion__severity">Working well</span>
        </div>
        <p class="suggestion__headline">${escapeHtml(rule.headline)}</p>
        <p class="suggestion__fix">${escapeHtml(rule.fix)}</p>
      </li>`
    ),
  ];

  suggestionsElement.innerHTML = cards.join('');
}
