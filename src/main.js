/**
 * Application wiring: intake → extraction → analysis → render.
 */
import './styles.css';
import { extractText, validate } from './extract/index.js';
import { terminateOcr } from './extract/ocr.js';
import { analyze } from './analyze/analyzer.js';
import { createDropzone } from './ui/dropzone.js';
import { createStatus } from './ui/status.js';
import { renderAnalysis, renderExtraction } from './ui/render.js';

const dom = {
  dropzone: document.getElementById('dropzone'),
  input: document.getElementById('file-input'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  platform: document.getElementById('platform-select'),
  reset: document.getElementById('reset-btn'),
  copy: document.getElementById('copy-btn'),
  meta: document.getElementById('extraction-meta'),
  text: document.getElementById('extracted-text'),
  score: document.getElementById('score'),
  metrics: document.getElementById('metrics'),
  suggestions: document.getElementById('suggestions'),
};

const status = createStatus(dom.status);

/** Last successful extraction, kept so switching platform re-scores instantly. */
let lastRun = null;
/** Incremented per upload; a stale run's results are discarded on arrival. */
let runId = 0;

function showResults(visible) {
  dom.results.hidden = !visible;
  dom.reset.hidden = !visible;
}

function runAnalysis() {
  if (!lastRun) return;
  const analysis = analyze(lastRun.result.text, dom.platform.value);
  renderAnalysis(
    { scoreElement: dom.score, metricsElement: dom.metrics, suggestionsElement: dom.suggestions },
    analysis
  );
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

    lastRun = { file, result };
    renderExtraction({ metaElement: dom.meta, textElement: dom.text }, { file, result });
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

createDropzone({ element: dom.dropzone, input: dom.input, onFile: handleFile });

dom.platform.addEventListener('change', runAnalysis);

dom.copy.addEventListener('click', async () => {
  if (!lastRun) return;
  try {
    await navigator.clipboard.writeText(lastRun.result.text);
    dom.copy.textContent = 'Copied';
  } catch {
    // Clipboard access can be blocked (insecure origin, permissions):
    // fall back to selecting the text so the user can copy it manually.
    getSelection()?.selectAllChildren(dom.text);
    dom.copy.textContent = 'Select & copy';
  }
  setTimeout(() => {
    dom.copy.textContent = 'Copy';
  }, 1800);
});

dom.reset.addEventListener('click', () => {
  runId += 1;
  lastRun = null;
  showResults(false);
  status.clear();
  terminateOcr();
  dom.dropzone.focus();
});
