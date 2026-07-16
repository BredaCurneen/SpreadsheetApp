import { Request, Response, NextFunction } from 'express';
import { PdfExtractService } from '../services/pdfExtract.service';
import { logger } from '../utils/logger';

const pdfExtractService = new PdfExtractService();

/**
 * POST /api/pdf/extract-xml
 *
 * Accepts a multipart/form-data upload with a single "file" field (a PDF).
 * Returns:
 *   200  application/xml — the extracted embedded XML attachment
 *   400  { success: false, message: string }
 *   500  { success: false, message: string }
 */
export async function extractXmlHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded. Send a multipart/form-data request with field "file".' });
      return;
    }

    logger.info(`Extracting embedded XML from PDF: ${req.file.originalname} (${req.file.size} bytes)`);

    const xml = await pdfExtractService.extractXml(req.file.buffer);

    logger.info(`Extracted embedded XML (${xml.length} bytes) from ${req.file.originalname}`);

    res.status(200);
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    next(err);
  }
}
