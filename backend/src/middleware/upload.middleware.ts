import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';
import path from 'path';

const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.oasis.opendocument.spreadsheet',                     // ods
  'text/csv',
  'text/plain', // some browsers send csv as text/plain
  'application/octet-stream', // fallback for some xlsx uploads
]);

const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.ods', '.csv']);

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type "${ext}". Upload .xlsx, .ods, or .csv.`));
  }
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter,
});
