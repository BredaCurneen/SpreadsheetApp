import { Router } from 'express';
import { generateCiiHandler } from '../controllers/cii.controller';

const router = Router();

/**
 * POST /api/cii/generate
 * JSON body: { xml: string }
 */
router.post('/cii/generate', generateCiiHandler);

export default router;
