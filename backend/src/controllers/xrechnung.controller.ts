import { Request, Response, NextFunction } from 'express';
import { XRechnungService } from '../services/xrechnung.service';
import { logger } from '../utils/logger';

const xrechnungService = new XRechnungService();

/**
 * POST /api/xrechnung/generate
 *
 * Body: { xml: string } — the UBL XML already produced by POST /api/convert.
 * Returns:
 *   200  application/xml (attachment) — XRechnung XML (EN16931, CII syntax)
 *   400  { success: false, message: string }
 *   500  { success: false, message: string }
 */
export async function generateXRechnungHandler(
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

    logger.info(`Generating XRechnung XML from UBL XML (${xml.length} bytes)`);

    const xrechnungXml = await xrechnungService.generate(xml);

    logger.info(`Generated XRechnung XML (${xrechnungXml.length} bytes)`);

    res.status(200);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="xrechnung.xml"');
    res.send(xrechnungXml);
  } catch (err) {
    next(err);
  }
}
