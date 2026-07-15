import * as XLSX from 'xlsx';
import path from 'path';

export type SheetMatrix = (string | number | boolean | Date | null | undefined)[][];

/**
 * Parses an xlsx / ods / csv buffer into a 2-D cell matrix keyed by sheet name.
 * Uses SheetJS under the hood — same library used by e-invoice-eu.
 */
export class SpreadsheetService {
  parse(buffer: Buffer, originalName: string): Record<string, SheetMatrix> {
    const ext = path.extname(originalName).toLowerCase();

    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: true,     // parse date serials as JS Date
      cellNF: false,
      cellText: false,
      raw: ext === '.csv', // keep raw strings for CSV so numbers aren't coerced
    });

    const result: Record<string, SheetMatrix> = {};

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      result[sheetName] = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        defval: null,
        blankrows: true,
      }) as SheetMatrix;
    }

    return result;
  }

  /**
   * Returns the first available sheet name that matches (case-insensitive),
   * or the first sheet if none matches.
   */
  resolveSheetName(sheets: Record<string, SheetMatrix>, target: string): string {
    const normalised = target.toLowerCase();
    const match = Object.keys(sheets).find((n) => n.toLowerCase() === normalised);
    return match ?? Object.keys(sheets)[0] ?? '';
  }

  getCellValue(matrix: SheetMatrix, row: number, col: number): string {
    const rowData = matrix[row];
    if (!rowData) return '';
    // Use unknown so instanceof Date is a valid type guard
    const val: unknown = rowData[col];
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return String(val).trim();
  }
}
