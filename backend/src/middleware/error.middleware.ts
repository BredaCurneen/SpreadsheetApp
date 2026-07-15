import { Request, Response, NextFunction } from 'express';
import { MulterError } from 'multer';
import { logger } from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  details?: unknown;
}

export function errorMiddleware(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error(`${err.name}: ${err.message}`, { stack: err.stack, details: err.details });

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, message: 'File too large. Maximum size is 10 MB.' });
      return;
    }
    res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    return;
  }

  const status = err.statusCode ?? 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ success: false, message, details: err.details });
}
