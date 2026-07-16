import { Request, Response, NextFunction } from 'express';
import { FacturxService } from '../services/facturx.service';
import { logger } from '../utils/logger';

const facturxService = new FacturxService();

/**
 * POST /api/facturx/pdf
 *
 * Body: { xml: string } — the UBL XML already produced by POST /api/convert.
 * Returns:
 *   200  application/pdf (Factur-X / PDF-A-3 binary)
 *   400  { success: false, message: string }
 *   500  { success: false, message: string }
 */
export async function generateFacturXPdfHandler(
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

    logger.info(`Generating Factur-X PDF from XML (${xml.length} bytes)`);

    const pdfBuffer = await facturxService.generatePdf(xml);

    logger.info(`Generated Factur-X PDF (${pdfBuffer.length} bytes)`);

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="invoice.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}
