/**
 * Renders extraction output and analysis results into the DOM.
 */
import { escapeHtml } from './status.js';
import { formatBytes } from '../extract/index.js';

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

  textElement.textContent = result.text || '';
  textElement.classList.toggle('extracted--empty', result.text.length === 0);
  if (result.text.length === 0) {
    textElement.textContent =
      'No readable text was found in this file. If it is a photo, try a sharper, better-lit image.';
  }
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
