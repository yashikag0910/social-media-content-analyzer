/**
 * Application wiring: intake → extraction → analysis → rewrite → render.
 */
import './styles.css';
import { extractText, validate } from './extract/index.js';
import { terminateOcr } from './extract/ocr.js';
import { analyze } from './analyze/analyzer.js';
import { rewrite } from './analyze/rewrite.js';
import { createDropzone } from './ui/dropzone.js';
import { createStatus } from './ui/status.js';
import { createSourceMap } from './ui/sourcemap.js';
import { focusLine, renderAnalysis, renderExtraction, renderRewrite } from './ui/render.js';

const dom = {
  dropzone: document.getElementById('dropzone'),
  input: document.getElementById('file-input'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  platform: document.getElementById('platform-select'),
  reset: document.getElementById('reset-btn'),
  copy: document.getElementById('copy-btn'),
  copyDraft: document.getElementById('copy-draft-btn'),
  meta: document.getElementById('extraction-meta'),
  text: document.getElementById('extracted-text'),
  pageBar: document.getElementById('page-bar'),
  pageView: document.getElementById('page-view'),
  legend: document.getElementById('confidence-legend'),
  score: document.getElementById('score'),
  metrics: document.getElementById('metrics'),
  suggestions: document.getElementById('suggestions'),
  rewrite: document.getElementById('rewrite'),
};

const status = createStatus(dom.status);

const sourceMap = createSourceMap({
  barElement: dom.pageBar,
  viewElement: dom.pageView,
  legendElement: dom.legend,
  onSelect: (index) => focusLine(dom.text, index),
});

/** Last successful extraction, kept so switching platform re-scores instantly. */
let lastRun = null;
/** Latest rewrite, held for the copy button. */
let lastDraft = null;
/** Incremented per upload; a stale run's results are discarded on arrival. */
let runId = 0;

function showResults(visible) {
  dom.results.hidden = !visible;
  dom.reset.hidden = !visible;
}

/** Re-score and re-draft against the currently selected platform. */
function runAnalysis() {
  if (!lastRun) return;
  const platform = dom.platform.value;

  renderAnalysis(
    { scoreElement: dom.score, metricsElement: dom.metrics, suggestionsElement: dom.suggestions },
    analyze(lastRun.result.text, platform)
  );

  lastDraft = lastRun.result.text ? rewrite(lastRun.result.text, platform) : null;
  renderRewrite(dom.rewrite, lastDraft);
  dom.copyDraft.hidden = !lastDraft?.changed;
}

async function handleFile(file) {
  const currentRun = (runId += 1);
  const isCurrent = () => currentRun === runId;

  try {
    // Fail fast on type/size before spinning up any expensive machinery.
    validate(file);
  } catch (err) {
    status.error(err.message);
    return;
  }

  showResults(false);
  status.busy(`Reading “${file.name}”…`);

  try {
    const result = await extractText(file, {
      onProgress: (progress) => {
        if (isCurrent()) status.progress(progress);
      },
    });

    if (!isCurrent()) return;

    releaseLastRun();
    lastRun = { file, result };
    renderExtraction({ metaElement: dom.meta, textElement: dom.text }, { file, result });
    sourceMap.render(result);
    runAnalysis();
    showResults(true);

    const notes = result.notes?.length ? ` ${result.notes.join(' ')}` : '';
    if (result.text.length === 0) {
      status.error(
        `No text could be read from “${file.name}”.${notes} Try a clearer scan or a text-based PDF.`
      );
    } else {
      status.success(
        `Read ${result.text.length.toLocaleString()} characters from “${file.name}” via ${result.method}.${notes}`
      );
    }
  } catch (err) {
    if (!isCurrent()) return;
    status.error(err?.message ?? 'The file could not be processed.');
    showResults(false);
  }
}

/** Image previews are object URLs; they leak until explicitly revoked. */
function releaseLastRun() {
  for (const image of lastRun?.result.pageImages ?? []) {
    if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  }
}

/** Copy helper shared by both copy buttons, with a fallback for blocked clipboards. */
async function copyToClipboard(button, text, fallbackElement) {
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    // Clipboard access can be blocked (insecure origin, permissions):
    // fall back to selecting the text so the user can copy it manually.
    if (fallbackElement) getSelection()?.selectAllChildren(fallbackElement);
    button.textContent = 'Select & copy';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

createDropzone({ element: dom.dropzone, input: dom.input, onFile: handleFile });

dom.platform.addEventListener('change', runAnalysis);

// Text pane → source map. Delegated, since the lines are re-rendered per file.
for (const type of ['mouseover', 'click', 'focusin']) {
  dom.text.addEventListener(type, (event) => {
    const line = event.target.closest('.line[data-index]');
    if (!line) return;
    sourceMap.focus(Number(line.dataset.index));
    if (type !== 'mouseover') focusLine(dom.text, Number(line.dataset.index));
  });
}

dom.copy.addEventListener('click', () => {
  if (lastRun) copyToClipboard(dom.copy, lastRun.result.text, dom.text);
});

dom.copyDraft.addEventListener('click', () => {
  if (lastDraft) copyToClipboard(dom.copyDraft, lastDraft.text, document.getElementById('draft-text'));
});

dom.reset.addEventListener('click', () => {
  runId += 1;
  releaseLastRun();
  lastRun = null;
  lastDraft = null;
  sourceMap.clear();
  showResults(false);
  status.clear();
  terminateOcr();
  dom.dropzone.focus();
});
