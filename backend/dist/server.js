"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const convert_route_1 = __importDefault(require("./routes/convert.route"));
const error_middleware_1 = require("./middleware/error.middleware");
const logger_1 = require("./utils/logger");
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);
const FRONTEND_ORIGIN = process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:4200';
const app = (0, express_1.default)();
// ── Middleware ────────────────────────────────────────────────────────────────
app.use((0, cors_1.default)({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express_1.default.json());
// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', convert_route_1.default);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
// ── Error handler (must be last) ──────────────────────────────────────────────
app.use(error_middleware_1.errorMiddleware);
app.listen(PORT, () => {
    logger_1.logger.info(`Spreadsheet-to-UBL backend listening on http://localhost:${PORT}`);
    logger_1.logger.info(`CORS allowed origin: ${FRONTEND_ORIGIN}`);
});
exports.default = app;
