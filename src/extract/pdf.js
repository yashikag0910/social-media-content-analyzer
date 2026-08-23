/**
 * PDF text extraction with layout reconstruction.
 *
 * pdf.js hands back a flat list of positioned text runs, not lines or
 * paragraphs. Naively concatenating `item.str` collapses a formatted post into
 * one run-on blob, which then poisons every downstream readability metric. So
 * we rebuild the visual structure from the glyph coordinates: group runs into
 * lines by their baseline, insert spaces where there is a horizontal gap,
 * insert blank lines where there is a vertical one, and keep relative indents
 * so bullets and nested lists survive.
 */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Baselines within this fraction of the line height count as the same line. */
const SAME_LINE_RATIO = 0.5;
/** A horizontal gap wider than this fraction of the font height becomes a space. */
const SPACE_GAP_RATIO = 0.22;
/** A vertical gap wider than this multiple of the line height becomes a blank line. */
const PARAGRAPH_GAP_RATIO = 1.6;
/** Below this many characters per page we assume the PDF is a scan, not real text. */
const SCANNED_CHARS_PER_PAGE = 24;
/** Rendering scale for the OCR fallback — enough resolution for Tesseract. */
const OCR_RENDER_SCALE = 2;

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
async function loadDocument(buffer) {
  try {
    return await pdfjs.getDocument({ data: buffer, isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new Error('This PDF is password-protected, so its text cannot be read.');
    }
    if (err?.name === 'InvalidPDFException') {
      throw new Error('This file is not a readable PDF — it may be corrupt or incomplete.');
    }
    throw new Error(`Could not open the PDF: ${err?.message ?? 'unknown error'}`);
  }
}

/** Median of a numeric array, used to resist outlier font sizes. */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Turn pdf.js text items into positioned line objects.
 * @param {Array<object>} items
 */
function groupIntoLines(items) {
  const runs = items
    .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
    .map((item) => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
      // transform[3] is the vertical scale, a more reliable font size than item.height.
      height: Math.abs(item.transform[3]) || item.height || 10,
    }));

  if (runs.length === 0) return { lines: [], lineHeight: 0 };

  const lineHeight = median(runs.map((run) => run.height)) || 10;
  const tolerance = lineHeight * SAME_LINE_RATIO;

  // Descending y: PDF user space has the origin at the bottom-left.
  runs.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const run of runs) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - run.y) <= tolerance) {
      current.runs.push(run);
      current.y = (current.y * (current.runs.length - 1) + run.y) / current.runs.length;
    } else {
      lines.push({ y: run.y, runs: [run] });
    }
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    line.x = line.runs[0].x;
    line.height = median(line.runs.map((run) => run.height)) || lineHeight;
    line.text = line.runs.reduce((acc, run, index) => {
      if (index === 0) return run.text;
      const previous = line.runs[index - 1];
      const gap = run.x - (previous.x + previous.width);
      const needsSpace =
        gap > previous.height * SPACE_GAP_RATIO &&
        !/\s$/.test(acc) &&
        !/^\s/.test(run.text);
      return acc + (needsSpace ? ' ' : '') + run.text;
    }, '');
  }

  return { lines, lineHeight };
}

/**
 * Render grouped lines back to text, restoring blank lines and indentation.
 */
function linesToText({ lines, lineHeight }) {
  if (lines.length === 0) return '';

  const leftMargin = Math.min(...lines.map((line) => line.x));
  const out = [];

  lines.forEach((line, index) => {
    if (index > 0) {
      const previous = lines[index - 1];
      const verticalGap = previous.y - line.y;
      const threshold = Math.max(previous.height, lineHeight) * PARAGRAPH_GAP_RATIO;
      if (verticalGap > threshold) out.push('');
    }
    // Approximate character width, so indents land in sensible units.
    const charWidth = line.height * 0.5 || 5;
    const indent = Math.min(Math.round((line.x - leftMargin) / charWidth), 12);
    out.push((indent > 0 ? ' '.repeat(indent) : '') + line.text.trim());
  });

  return out.join('\n');
}

/**
 * Rasterise a page so Tesseract can read it.
 * @returns {Promise<HTMLCanvasElement>}
 */
async function renderPageToCanvas(page) {
  const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // A white backdrop: transparent PDFs otherwise OCR as black-on-black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // `intent: 'print'` is what switches pdf.js off requestAnimationFrame-driven
  // rendering. rAF is frozen in a background tab, so the default intent would
  // leave this promise pending forever if the user switched away mid-OCR.
  await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
  return canvas;
}

/**
 * Extract text from a PDF, falling back to OCR when the file is a scan.
 *
 * @param {File} file
 * @param {object} options
 * @param {(progress: {phase: string, ratio: number, detail?: string}) => void} options.onProgress
 * @param {(canvas: HTMLCanvasElement, page: number, total: number) => Promise<string>} options.ocrPage
 *   Injected so this module stays independent of the OCR engine.
 * @returns {Promise<{text: string, method: string, pages: number, notes: string[]}>}
 */
export async function extractFromPdf(file, { onProgress, ocrPage }) {
  onProgress({ phase: 'Reading file', ratio: 0.02 });
  const buffer = await file.arrayBuffer();

  onProgress({ phase: 'Opening PDF', ratio: 0.06 });
  const doc = await loadDocument(buffer);
  const notes = [];

  try {
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      onProgress({
        phase: 'Extracting text',
        ratio: 0.06 + 0.54 * (pageNumber / doc.numPages),
        detail: `page ${pageNumber} of ${doc.numPages}`,
      });
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(linesToText(groupIntoLines(content.items)));
      page.cleanup();
    }

    const text = pageTexts.join('\n\n').trim();
    const density = text.replace(/\s/g, '').length / doc.numPages;

    if (density >= SCANNED_CHARS_PER_PAGE) {
      onProgress({ phase: 'Done', ratio: 1 });
      return { text, method: 'PDF text layer', pages: doc.numPages, notes };
    }

    // Little or no embedded text: this is almost certainly a scan, so rasterise
    // each page and hand it to OCR rather than reporting an empty document.
    notes.push(
      'No usable text layer was found, so each page was rendered and read with OCR.'
    );
    const ocrTexts = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const canvas = await renderPageToCanvas(page);
      ocrTexts.push(await ocrPage(canvas, pageNumber, doc.numPages));
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }

    onProgress({ phase: 'Done', ratio: 1 });
    return {
      text: ocrTexts.join('\n\n').trim(),
      method: 'OCR (scanned PDF)',
      pages: doc.numPages,
      notes,
    };
  } finally {
    await doc.destroy();
  }
}
