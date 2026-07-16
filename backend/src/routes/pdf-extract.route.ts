import { Router } from 'express';
import multer from 'multer';
import { extractXmlHandler } from '../controllers/pdfExtract.controller';

// Local multer instance: the shared upload.middleware.ts only accepts
// spreadsheet files (.xlsx/.ods/.csv), so PDF uploads need their own filter.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${file.mimetype}". Upload a .pdf file.`));
    }
  },
});

const router = Router();

/**
 * POST /api/pdf/extract-xml
 * Multipart upload — field name: "file"
 */
router.post('/pdf/extract-xml', pdfUpload.single('file'), extractXmlHandler);

export default router;
