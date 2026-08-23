/**
 * OCR for images and rasterised PDF pages, backed by Tesseract.js.
 *
 * The worker costs a few seconds and ~15 MB to spin up (it fetches the WASM
 * core and the English traineddata), so it is created lazily on first use and
 * then kept alive: analysing a second file is near-instant. The progress
 * callback is held in a mutable slot because Tesseract binds its logger once,
 * at worker-creation time, while our UI callback changes per file.
 */
import { createWorker } from 'tesseract.js';

let workerPromise = null;
/** @type {((progress: {phase: string, ratio: number, detail?: string}) => void) | null} */
let activeProgress = null;

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
 * Run OCR over anything Tesseract accepts (File, Blob, canvas, image element).
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement} image
 * @param {(progress: {phase: string, ratio: number, detail?: string}) => void} onProgress
 * @returns {Promise<{text: string, confidence: number}>}
 */
export async function recognize(image, onProgress) {
  const worker = await getWorker();
  activeProgress = onProgress;
  try {
    const { data } = await worker.recognize(image);
    return { text: (data.text ?? '').trim(), confidence: data.confidence ?? 0 };
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
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
  } catch {
    throw new Error(
      `“${file.name}” could not be decoded as an image — it may be corrupt, truncated, ` +
        'or saved in a format the browser does not support.'
    );
  }

  const { text, confidence } = await recognize(file, onProgress);
  const notes = [];
  if (confidence > 0 && confidence < 70) {
    notes.push(
      `OCR confidence was low (${Math.round(confidence)}%). A sharper or higher-contrast ` +
        'image will give a cleaner read.'
    );
  }
  onProgress({ phase: 'Done', ratio: 1 });
  return { text, method: 'OCR (image)', pages: 1, confidence, notes };
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
