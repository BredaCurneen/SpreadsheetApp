import { Router } from 'express';
import { generateFacturXPdfHandler } from '../controllers/facturx.controller';

const router = Router();

/**
 * POST /api/facturx/pdf
 * JSON body: { xml: string }
 */
router.post('/facturx/pdf', generateFacturXPdfHandler);

export default router;
