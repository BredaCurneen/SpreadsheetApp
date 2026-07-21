import { Request, Response, NextFunction } from 'express';
import { ZugferdService } from '../services/zugferd.service';
import { logger } from '../utils/logger';

const zugferdService = new ZugferdService();

/**
 * POST /api/zugferd/generate
 *
 * Body: { xml: string } — the UBL XML already produced by POST /api/convert.
 * Returns:
 *   200  application/pdf (attachment) — ZUGFeRD PDF/A-3 with embedded CII XML
 *   400  { success: false, message: string }
 *   500  { success: false, message: string }
 */
export async function generateZugferdHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const xml = req.body?.xml;

    if (!xml || typeof xml !== 'string') {
      res.status(400).json({ success: false, message: 'Request body must include an "xml" string field.' });
      return;
    }

    logger.info(`Generating ZUGFeRD PDF from UBL XML (${xml.length} bytes)`);

    const pdfBuffer = await zugferdService.generate(xml);

    logger.info(`Generated ZUGFeRD PDF (${pdfBuffer.length} bytes)`);

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="zugferd.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}
