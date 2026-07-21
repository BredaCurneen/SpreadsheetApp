import { Router } from 'express';
import { generateXRechnungHandler } from '../controllers/xrechnung.controller';

const router = Router();

/**
 * POST /api/xrechnung/generate
 * JSON body: { xml: string }
 */
router.post('/xrechnung/generate', generateXRechnungHandler);

export default router;
