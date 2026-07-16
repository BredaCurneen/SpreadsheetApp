import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

function badRequest(message: string): AppError {
  const err: AppError = new Error(message);
  err.statusCode = 400;
  return err;
}

// pdfjs-dist v6 ships ESM-only (.mjs) — it must be loaded via a dynamic import()
// even from this CommonJS backend; a static `import` would fail to compile/run.
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      // pdfjs loads the worker via a dynamic import() of this URL — on Windows a bare
      // filesystem path (e.g. "C:\...") isn't a valid ESM specifier, so it must be a file:// URL.
      const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const PREFERRED_ATTACHMENT_NAMES = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml'];

export class PdfExtractService {
  /**
   * Extracts the embedded invoice XML (e.g. factur-x.xml) from a PDF/A-3 attachment.
   * Throws if the PDF has no embedded files, or none of them look like XML.
   */
  async extractXml(pdfBuffer: Buffer): Promise<string> {
    const pdfjs = await loadPdfjs();

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    });

    const doc = await loadingTask.promise;
    try {
      const attachments = await doc.getAttachments();

      if (!attachments || attachments.size === 0) {
        throw badRequest('This PDF has no embedded file attachments.');
      }

      const entries = [...attachments.entries()];
      const [id, attachment] = pickXmlAttachment(entries);

      logger.info(`Extracting embedded attachment "${attachment.filename}" from PDF`);

      const content = attachment.content ?? (await doc.getAttachmentContent(id));
      if (!content) {
        throw badRequest(`Embedded attachment "${attachment.filename}" has no readable content.`);
      }

      return Buffer.from(content).toString('utf-8');
    } finally {
      await loadingTask.destroy();
    }
  }
}

function pickXmlAttachment(
  entries: [string, { filename: string; content?: Uint8Array | null }][],
): [string, { filename: string; content?: Uint8Array | null }] {
  for (const preferredName of PREFERRED_ATTACHMENT_NAMES) {
    const match = entries.find(([, a]) => a.filename.toLowerCase() === preferredName);
    if (match) return match;
  }

  const anyXml = entries.find(([, a]) => path.extname(a.filename).toLowerCase() === '.xml');
  if (anyXml) return anyXml;

  throw badRequest("No XML attachment found among this PDF's embedded files.");
}
