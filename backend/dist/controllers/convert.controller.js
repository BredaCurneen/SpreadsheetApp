"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertHandler = convertHandler;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const spreadsheet_service_1 = require("../services/spreadsheet.service");
const mapping_service_1 = require("../services/mapping.service");
const ubl_service_1 = require("../services/ubl.service");
const validator_service_1 = require("../services/validator.service");
const logger_1 = require("../utils/logger");
const MAPPING_PATH = path_1.default.join(__dirname, '../../mappings/default-invoice-mapping.json');
const ssService = new spreadsheet_service_1.SpreadsheetService();
const mappingService = new mapping_service_1.MappingService(ssService);
const ublService = new ubl_service_1.UblService();
const validatorService = new validator_service_1.ValidatorService();
let cachedMapping = null;
function loadMapping() {
    if (!cachedMapping) {
        const raw = fs_1.default.readFileSync(MAPPING_PATH, 'utf-8');
        cachedMapping = JSON.parse(raw);
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
async function convertHandler(req, res, next) {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, message: 'No file uploaded. Send a multipart/form-data request with field "file".' });
            return;
        }
        logger_1.logger.info(`Converting file: ${req.file.originalname} (${req.file.size} bytes)`);
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
        logger_1.logger.debug(`Mapped invoice: ${invoiceData.id} / ${invoiceData.seller.name} → ${invoiceData.buyer.name}`);
        // 3. Validate EN16931 business rules
        const errors = validatorService.validate(invoiceData);
        if (validatorService.hasFatals(errors)) {
            logger_1.logger.warn(`Validation failed for ${invoiceData.id}: ${errors.filter(e => e.severity === 'fatal').length} fatal error(s)`);
            res.status(400).json({
                success: false,
                message: 'Invoice failed EN16931 validation.',
                errors,
            });
            return;
        }
        // 4. Generate UBL XML
        const xml = ublService.generate(invoiceData);
        logger_1.logger.info(`Generated UBL XML for invoice ${invoiceData.id} (${xml.length} bytes)`);
        // Return warnings alongside the XML if any
        const response = { success: true, xml };
        if (errors.length > 0) {
            response['warnings'] = errors;
        }
        res.status(200).json(response);
    }
    catch (err) {
        next(err);
    }
}
