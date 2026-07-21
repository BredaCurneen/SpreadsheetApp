import express from 'express';
import cors from 'cors';
import convertRouter from './routes/convert.route';
import facturxRouter from './routes/facturx.route';
import pdfExtractRouter from './routes/pdf-extract.route';
import xrechnungRouter from './routes/xrechnung.route';
import { errorMiddleware } from './middleware/error.middleware';
import { logger } from './utils/logger';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const FRONTEND_ORIGIN = process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:4200';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', convertRouter);
app.use('/api', facturxRouter);
app.use('/api', pdfExtractRouter);
app.use('/api', xrechnungRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(errorMiddleware);

app.listen(PORT, () => {
  logger.info(`Spreadsheet-to-UBL backend listening on http://localhost:${PORT}`);
  logger.info(`CORS allowed origin: ${FRONTEND_ORIGIN}`);
});

export default app;
