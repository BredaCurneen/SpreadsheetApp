"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = errorMiddleware;
const multer_1 = require("multer");
const logger_1 = require("../utils/logger");
function errorMiddleware(err, _req, res, _next) {
    logger_1.logger.error(`${err.name}: ${err.message}`, { stack: err.stack, details: err.details });
    if (err instanceof multer_1.MulterError) {
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
