import { Router } from 'express';
import { upload } from '../middleware/upload.middleware';
import { convertHandler } from '../controllers/convert.controller';

const router = Router();

/**
 * POST /api/convert
 * Multipart upload — field name: "file"
 */
router.post('/convert', upload.single('file'), convertHandler);

export default router;
