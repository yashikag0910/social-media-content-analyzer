/**
 * OCR for images and rasterised PDF pages, backed by Tesseract.js.
 *
 * The worker costs a few seconds and ~15 MB to spin up (it fetches the WASM
 * core and the English traineddata), so it is created lazily on first use and
 * then kept alive: analysing a second file is near-instant. The progress
 * callback is held in a mutable slot because Tesseract binds its logger once,
 * at worker-creation time, while our UI callback changes per file.
 *
 * Tesseract reports a bounding box and a confidence for every line and word.
 * Both are kept: the boxes drive the source map, and the per-word confidence
 * is what makes a doubtful read visible instead of silently wrong.
 */
import { createWorker } from 'tesseract.js';
import { entriesToText } from './pdf.js';

let workerPromise = null;
/** @type {((progress: {phase: string, ratio: number, detail?: string}) => void) | null} */
let activeProgress = null;

/** Below this Tesseract confidence, a word is flagged in the source map. */
export const LOW_CONFIDENCE = 75;

/** A vertical gap wider than this multiple of line height becomes a blank line. */
const PARAGRAPH_GAP_RATIO = 0.75;

/** Tesseract status strings mapped to something a human wants to read. */
const PHASE_LABELS = {
  'loading tesseract core': 'Loading OCR engine',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Loading language data',
  'initializing api': 'Preparing OCR',
  'recognizing text': 'Reading text',
};

function handleTesseractLog(message) {
  if (!activeProgress) return;
  const phase = PHASE_LABELS[message.status] ?? 'Working';
  // Reserve the back half of the bar for recognition; setup fills the front.
  const ratio =
    message.status === 'recognizing text'
      ? 0.4 + 0.6 * (message.progress ?? 0)
      : 0.4 * (message.progress ?? 0);
  activeProgress({ phase, ratio });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { logger: handleTesseractLog }).catch((err) => {
      // Don't cache a failed worker: let the next attempt retry from scratch.
      workerPromise = null;
      throw new Error(
        `The OCR engine could not be loaded (${err?.message ?? 'network error'}). ` +
          'Check your connection and try again.'
      );
    });
  }
  return workerPromise;
}

/**
 * Convert Tesseract's line/word tree into the same entry shape the PDF parser
 * produces, so the rest of the app never has to know which engine ran.
 */
function linesToEntries(lines) {
  const heights = lines.map((line) => line.bbox.y1 - line.bbox.y0).filter(Boolean);
  const medianHeight = heights.length
    ? [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)]
    : 0;
  const leftMargin = lines.length ? Math.min(...lines.map((line) => line.bbox.x0)) : 0;

  return lines
    .filter((line) => line.text.trim() !== '')
    .map((line, index, kept) => {
      const previous = kept[index - 1];
      const blankBefore =
        index > 0 && line.bbox.y0 - previous.bbox.y1 > medianHeight * PARAGRAPH_GAP_RATIO;
      // Indent in approximate character widths, mirroring the PDF path.
      const charWidth = (line.bbox.y1 - line.bbox.y0) * 0.5 || 8;
      const indent = Math.min(Math.round((line.bbox.x0 - leftMargin) / charWidth), 12);

      return {
        text: line.text.replace(/\s+$/, '').trim(),
        indent,
        blankBefore,
        page: 1,
        box: {
          x: line.bbox.x0,
          y: line.bbox.y0,
          w: Math.max(line.bbox.x1 - line.bbox.x0, 2),
          h: Math.max(line.bbox.y1 - line.bbox.y0, 2),
        },
        confidence: line.confidence,
        words: (line.words ?? []).map((word) => ({
          text: word.text,
          confidence: word.confidence,
          box: {
            x: word.bbox.x0,
            y: word.bbox.y0,
            w: Math.max(word.bbox.x1 - word.bbox.x0, 2),
            h: Math.max(word.bbox.y1 - word.bbox.y0, 2),
          },
        })),
      };
    });
}

/**
 * Run OCR over anything Tesseract accepts (File, Blob, canvas, image element).
 *
 * @returns {Promise<{entries: Array<object>, confidence: number}>}
 */
export async function recognize(image, onProgress) {
  const worker = await getWorker();
  activeProgress = onProgress;
  try {
    // `blocks: true` is what populates the line/word tree; without it Tesseract
    // returns the plain text only and all the geometry is thrown away.
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return {
      entries: linesToEntries(data.lines ?? []),
      confidence: data.confidence ?? 0,
    };
  } catch (err) {
    throw new Error(`OCR failed on this image: ${err?.message ?? 'unknown error'}`);
  } finally {
    activeProgress = null;
  }
}

/**
 * Extract text from an image file.
 *
 * @param {File} file
 * @param {{onProgress: (progress: object) => void}} options
 */
export async function extractFromImage(file, { onProgress }) {
  // Decode first. Tesseract reports a truncated or mislabelled image as an
  // opaque failure, so check here where we can say something useful.
  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(file);
    ({ width, height } = bitmap);
    bitmap.close();
  } catch {
    throw new Error(
      `“${file.name}” could not be decoded as an image — it may be corrupt, truncated, ` +
        'or saved in a format the browser does not support.'
    );
  }

  const { entries, confidence } = await recognize(file, onProgress);

  const notes = [];
  const doubtful = entries
    .flatMap((entry) => entry.words ?? [])
    .filter((word) => word.confidence < LOW_CONFIDENCE);
  if (doubtful.length > 0) {
    notes.push(
      `${doubtful.length} word(s) read with low confidence — they are outlined in the source map.`
    );
  }

  onProgress({ phase: 'Done', ratio: 1 });
  return {
    text: entriesToText(entries),
    entries,
    pageImages: [{ page: 1, src: URL.createObjectURL(file), width, height }],
    method: 'OCR (image)',
    pages: 1,
    confidence,
    notes,
  };
}

/** Release the OCR worker and its memory. */
export async function terminateOcr() {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Nothing useful to do if teardown fails; the page is being reset anyway.
  }
}
