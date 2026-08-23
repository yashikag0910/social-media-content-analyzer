/**
 * PDF text extraction with layout reconstruction and provenance.
 *
 * pdf.js hands back a flat list of positioned text runs, not lines or
 * paragraphs. Naively concatenating `item.str` collapses a formatted post into
 * one run-on blob, which then poisons every downstream readability metric. So
 * we rebuild the visual structure from the glyph coordinates: group runs into
 * lines by their baseline, insert spaces where there is a horizontal gap,
 * insert blank lines where there is a vertical one, and keep relative indents
 * so bullets and nested lists survive.
 *
 * Those same coordinates are kept rather than discarded, converted into
 * page-image pixel space, so every line of output can point back at the exact
 * region of the document it came from.
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
/**
 * Width, in pixels, that pages are rasterised to. One render serves both the
 * source-map preview and OCR: on a letter-size page this is roughly 145 DPI,
 * which Tesseract reads reliably without the memory cost of a 300 DPI scan.
 */
const RENDER_WIDTH = 1200;
/** Cap on preview images held in memory; text is still extracted from every page. */
const MAX_PREVIEW_PAGES = 12;

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

/** Turn pdf.js text items into positioned line objects, in PDF user space. */
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
    line.right = Math.max(...line.runs.map((run) => run.x + run.width));
    line.text = line.runs.reduce((acc, run, index) => {
      if (index === 0) return run.text;
      const previous = line.runs[index - 1];
      const gap = run.x - (previous.x + previous.width);
      const needsSpace =
        gap > previous.height * SPACE_GAP_RATIO && !/\s$/.test(acc) && !/^\s/.test(run.text);
      return acc + (needsSpace ? ' ' : '') + run.text;
    }, '');
  }

  return { lines, lineHeight };
}

/**
 * Convert a line's PDF-space extent into a box in rendered-page pixel space.
 * Ascender and descender are approximated from the font height, since pdf.js
 * reports a baseline rather than a glyph bounding box.
 */
function lineToBox(line, viewport) {
  const top = line.y + line.height * 0.82;
  const bottom = line.y - line.height * 0.22;
  const [x0, y0] = viewport.convertToViewportPoint(line.x, top);
  const [x1, y1] = viewport.convertToViewportPoint(line.right, bottom);
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.max(Math.abs(x1 - x0), 2),
    h: Math.max(Math.abs(y1 - y0), 2),
  };
}

/**
 * Render grouped lines into text entries, restoring blank lines and indentation
 * while keeping each entry's source box.
 */
function toEntries({ lines, lineHeight }, { page, viewport }) {
  if (lines.length === 0) return [];

  const leftMargin = Math.min(...lines.map((line) => line.x));

  return lines.map((line, index) => {
    let blankBefore = false;
    if (index > 0) {
      const previous = lines[index - 1];
      const threshold = Math.max(previous.height, lineHeight) * PARAGRAPH_GAP_RATIO;
      blankBefore = previous.y - line.y > threshold;
    }
    // Approximate character width, so indents land in sensible units.
    const charWidth = line.height * 0.5 || 5;
    const indent = Math.min(Math.round((line.x - leftMargin) / charWidth), 12);

    return {
      text: line.text.trim(),
      indent,
      blankBefore,
      page,
      box: viewport ? lineToBox(line, viewport) : null,
      confidence: null,
    };
  });
}

/** Rasterise a page. The result serves as both preview image and OCR input. */
async function renderPage(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(RENDER_WIDTH / base.width, 3);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // A white backdrop: transparent PDFs otherwise render as black-on-black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // `intent: 'print'` is what switches pdf.js off requestAnimationFrame-driven
  // rendering. rAF is frozen in a background tab, so the default intent would
  // leave this promise pending forever if the user switched away mid-render.
  await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
  return { canvas, viewport };
}

/**
 * Extract text from a PDF, falling back to OCR when the file is a scan.
 *
 * @param {File} file
 * @param {object} options
 * @param {(progress: {phase: string, ratio: number, detail?: string}) => void} options.onProgress
 * @param {(canvas: HTMLCanvasElement, page: number, total: number) => Promise<{entries: Array<object>, confidence: number}>} options.ocrPage
 *   Injected so this module stays independent of the OCR engine.
 */
export async function extractFromPdf(file, { onProgress, ocrPage }) {
  onProgress({ phase: 'Reading file', ratio: 0.02 });
  const buffer = await file.arrayBuffer();

  onProgress({ phase: 'Opening PDF', ratio: 0.05 });
  const doc = await loadDocument(buffer);
  const notes = [];
  const pageImages = [];

  try {
    /* Pass 1: text layer only — cheap, and it decides whether OCR is needed. */
    const perPageLines = [];
    let totalChars = 0;
    for (let number = 1; number <= doc.numPages; number += 1) {
      onProgress({
        phase: 'Extracting text',
        ratio: 0.05 + 0.35 * (number / doc.numPages),
        detail: `page ${number} of ${doc.numPages}`,
      });
      const page = await doc.getPage(number);
      const grouped = groupIntoLines((await page.getTextContent()).items);
      perPageLines.push(grouped);
      totalChars += grouped.lines.reduce((sum, line) => sum + line.text.replace(/\s/g, '').length, 0);
      page.cleanup();
    }

    const isScanned = totalChars / doc.numPages < SCANNED_CHARS_PER_PAGE;
    if (isScanned) {
      notes.push('No usable text layer was found, so each page was rendered and read with OCR.');
    }
    const previewPages = Math.min(doc.numPages, MAX_PREVIEW_PAGES);
    if (doc.numPages > previewPages) {
      notes.push(
        `Source map shows the first ${previewPages} of ${doc.numPages} pages; text was extracted from all of them.`
      );
    }

    /* Pass 2: rasterise for the source map, and for OCR when the text layer is absent. */
    const entries = [];
    const confidences = [];
    const pagesToRender = isScanned ? doc.numPages : previewPages;

    for (let number = 1; number <= doc.numPages; number += 1) {
      const needsRender = number <= pagesToRender;
      let viewport = null;

      if (needsRender) {
        onProgress({
          phase: isScanned ? 'Rendering page for OCR' : 'Building source map',
          ratio: 0.4 + 0.15 * (number / pagesToRender),
          detail: `page ${number} of ${pagesToRender}`,
        });
        const page = await doc.getPage(number);
        const rendered = await renderPage(page);
        viewport = rendered.viewport;

        if (isScanned) {
          const result = await ocrPage(rendered.canvas, number, doc.numPages);
          entries.push(...result.entries.map((entry) => ({ ...entry, page: number })));
          if (result.confidence > 0) confidences.push(result.confidence);
        }

        if (number <= previewPages) {
          pageImages.push({
            page: number,
            src: rendered.canvas.toDataURL('image/jpeg', 0.82),
            width: rendered.canvas.width,
            height: rendered.canvas.height,
          });
        }
        rendered.canvas.width = 0;
        rendered.canvas.height = 0;
        page.cleanup();
      }

      if (!isScanned) {
        entries.push(...toEntries(perPageLines[number - 1], { page: number, viewport }));
      }
    }

    onProgress({ phase: 'Done', ratio: 1 });
    return {
      text: entriesToText(entries),
      entries,
      pageImages,
      method: isScanned ? 'OCR (scanned PDF)' : 'PDF text layer',
      pages: doc.numPages,
      confidence: confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : undefined,
      notes,
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Flatten entries back into the plain text the analyzer scores. Kept here so
 * the text and the source map can never disagree about what was extracted.
 */
export function entriesToText(entries) {
  const out = [];
  entries.forEach((entry, index) => {
    if (entry.blankBefore && index > 0) out.push('');
    out.push(' '.repeat(entry.indent ?? 0) + entry.text);
  });
  return out.join('\n').trim();
}
