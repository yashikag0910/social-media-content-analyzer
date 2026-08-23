/**
 * Entry point for text extraction: validate the file, then route it to the
 * right engine — the PDF parser or OCR.
 */
import { extractFromPdf } from './pdf.js';
import { extractFromImage, recognize } from './ocr.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/bmp',
  'image/gif',
]);

const EXTENSION_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  gif: 'image/gif',
};

/** Browsers occasionally hand over an empty `type`; fall back to the extension. */
function resolveType(file) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? '';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {File} file
 * @throws {Error} with a message written for the user, not the console.
 */
export function validate(file) {
  const type = resolveType(file);
  if (type !== 'application/pdf' && !IMAGE_TYPES.has(type)) {
    throw new Error(
      `“${file.name}” is not a supported file. Upload a PDF or an image (PNG, JPG, WEBP, BMP, GIF).`
    );
  }
  if (file.size === 0) {
    throw new Error(`“${file.name}” is empty.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`
    );
  }
  return type;
}

/**
 * Extract text from a validated file.
 *
 * @param {File} file
 * @param {{onProgress: (progress: {phase: string, ratio: number, detail?: string}) => void}} options
 * @returns {Promise<{text: string, method: string, pages: number, notes: string[]}>}
 */
export async function extractText(file, { onProgress }) {
  const type = validate(file);

  if (type === 'application/pdf') {
    return extractFromPdf(file, {
      onProgress,
      // OCR fallback for scanned PDFs, spread across the tail of the progress bar.
      ocrPage: async (canvas, pageNumber, totalPages) => {
        const { text } = await recognize(canvas, ({ phase, ratio }) => {
          const pageShare = (pageNumber - 1 + ratio) / totalPages;
          onProgress({
            phase,
            ratio: 0.6 + 0.4 * pageShare,
            detail: `page ${pageNumber} of ${totalPages}`,
          });
        });
        return text;
      },
    });
  }

  return extractFromImage(file, { onProgress });
}
