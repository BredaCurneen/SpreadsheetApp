"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpreadsheetService = void 0;
const XLSX = __importStar(require("xlsx"));
const path_1 = __importDefault(require("path"));
/**
 * Parses an xlsx / ods / csv buffer into a 2-D cell matrix keyed by sheet name.
 * Uses SheetJS under the hood — same library used by e-invoice-eu.
 */
class SpreadsheetService {
    parse(buffer, originalName) {
        const ext = path_1.default.extname(originalName).toLowerCase();
        const workbook = XLSX.read(buffer, {
            type: 'buffer',
            cellDates: true, // parse date serials as JS Date
            cellNF: false,
            cellText: false,
            raw: ext === '.csv', // keep raw strings for CSV so numbers aren't coerced
        });
        const result = {};
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            result[sheetName] = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                defval: null,
                blankrows: true,
            });
        }
        return result;
    }
    /**
     * Returns the first available sheet name that matches (case-insensitive),
     * or the first sheet if none matches.
     */
    resolveSheetName(sheets, target) {
        const normalised = target.toLowerCase();
        const match = Object.keys(sheets).find((n) => n.toLowerCase() === normalised);
        return match ?? Object.keys(sheets)[0] ?? '';
    }
    getCellValue(matrix, row, col) {
        const rowData = matrix[row];
        if (!rowData)
            return '';
        // Use unknown so instanceof Date is a valid type guard
        const val = rowData[col];
        if (val === null || val === undefined)
            return '';
        if (val instanceof Date)
            return val.toISOString().slice(0, 10);
        return String(val).trim();
    }
}
exports.SpreadsheetService = SpreadsheetService;
