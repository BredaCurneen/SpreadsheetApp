"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const upload_middleware_1 = require("../middleware/upload.middleware");
const convert_controller_1 = require("../controllers/convert.controller");
const router = (0, express_1.Router)();
/**
 * POST /api/convert
 * Multipart upload — field name: "file"
 */
router.post('/convert', upload_middleware_1.upload.single('file'), convert_controller_1.convertHandler);
exports.default = router;
