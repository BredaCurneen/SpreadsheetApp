import { Router } from 'express';
import { generateZugferdHandler } from '../controllers/zugferd.controller';

const router = Router();

/**
 * POST /api/zugferd/generate
 * JSON body: { xml: string }
 */
router.post('/zugferd/generate', generateZugferdHandler);

export default router;
