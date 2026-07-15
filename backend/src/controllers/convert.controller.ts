import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { SpreadsheetService } from '../services/spreadsheet.service';
import { MappingService } from '../services/mapping.service';
import { UblService } from '../services/ubl.service';
import { ValidatorService } from '../services/validator.service';
import { MappingConfig } from '../types/invoice.types';
import { logger } from '../utils/logger';

const MAPPING_PATH = path.join(__dirname, '../../mappings/default-invoice-mapping.json');

const ssService = new SpreadsheetService();
const mappingService = new MappingService(ssService);
const ublService = new UblService();
const validatorService = new ValidatorService();

let cachedMapping: MappingConfig | null = null;

function loadMapping(): MappingConfig {
  if (!cachedMapping) {
    const raw = fs.readFileSync(MAPPING_PATH, 'utf-8');
    cachedMapping = JSON.parse(raw) as MappingConfig;
  }
  return cachedMapping;
}

/**
 * POST /api/convert
 *
 * Accepts a multipart/form-data upload with a single "file" field.
 * Returns:
 *   200  { success: true,  xml: string }
 *   400  { success: false, errors: ValidationError[], message: string }
 *   500  { success: false, message: string }
 */
export async function convertHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded. Send a multipart/form-data request with field "file".' });
      return;
    }

    logger.info(`Converting file: ${req.file.originalname} (${req.file.size} bytes)`);

    // 1. Parse spreadsheet
    const sheets = ssService.parse(req.file.buffer, req.file.originalname);
    const mapping = loadMapping();
    const sheetName = ssService.resolveSheetName(sheets, mapping.sheet);

    if (!sheetName || !sheets[sheetName]) {
      res.status(400).json({
        success: false,
        message: `Sheet "${mapping.sheet}" not found. Available sheets: ${Object.keys(sheets).join(', ')}.`,
      });
      return;
    }

    const matrix = sheets[sheetName];

    // 2. Apply mapping
    const invoiceData = mappingService.apply(matrix, mapping);
    logger.debug(`Mapped invoice: ${invoiceData.id} / ${invoiceData.seller.name} → ${invoiceData.buyer.name}`);

    // 3. Validate EN16931 business rules
    const errors = validatorService.validate(invoiceData);

    if (validatorService.hasFatals(errors)) {
      logger.warn(`Validation failed for ${invoiceData.id}: ${errors.filter(e => e.severity === 'fatal').length} fatal error(s)`);
      res.status(400).json({
        success: false,
        message: 'Invoice failed EN16931 validation.',
        errors,
      });
      return;
    }

    // 4. Generate UBL XML
    const xml = ublService.generate(invoiceData);
    logger.info(`Generated UBL XML for invoice ${invoiceData.id} (${xml.length} bytes)`);

    // Return warnings alongside the XML if any
    const response: Record<string, unknown> = { success: true, xml };
    if (errors.length > 0) {
      response['warnings'] = errors;
    }

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
}
