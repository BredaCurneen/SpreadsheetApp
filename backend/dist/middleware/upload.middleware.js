"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const ALLOWED_MIMES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.oasis.opendocument.spreadsheet', // ods
    'text/csv',
    'text/plain', // some browsers send csv as text/plain
    'application/octet-stream', // fallback for some xlsx uploads
]);
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.ods', '.csv']);
function fileFilter(_req, file, cb) {
    const ext = path_1.default.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext) || ALLOWED_MIMES.has(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error(`Unsupported file type "${ext}". Upload .xlsx, .ods, or .csv.`));
    }
}
exports.upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter,
});
