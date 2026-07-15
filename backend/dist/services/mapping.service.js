"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MappingService = void 0;
const logger_1 = require("../utils/logger");
const VALID_TAX_CATS = new Set(['S', 'Z', 'E', 'AE', 'K', 'O']);
class MappingService {
    constructor(ss) {
        this.ss = ss;
    }
    apply(matrix, cfg) {
        const f = cfg.fields;
        const cell = (ref) => ref ? this.ss.getCellValue(matrix, ref.row, ref.col) : '';
        const lines = this.extractLines(matrix, f.lineItemsStartRow, f.lineItemColumns);
        const netAmount = lines.reduce((s, l) => s + l.netAmount, 0);
        const taxAmount = lines.reduce((s, l) => s + l.vatAmount, 0);
        const deliveryDate = f.delivery?.actualDeliveryDate
            ? this.normaliseDate(cell(f.delivery.actualDeliveryDate)) || undefined
            : undefined;
        const deliveryCountry = f.delivery?.countryCode
            ? cell(f.delivery.countryCode) || undefined
            : undefined;
        const deliveryCity = f.delivery?.city
            ? cell(f.delivery.city) || undefined
            : undefined;
        const deliveryPostalCode = f.delivery?.postalCode
            ? cell(f.delivery.postalCode) || undefined
            : undefined;
        return {
            id: cell(f.invoiceId),
            issueDate: this.normaliseDate(cell(f.issueDate)),
            dueDate: f.dueDate ? this.normaliseDate(cell(f.dueDate)) : undefined,
            typeCode: cell(f.typeCode) || '380',
            currencyCode: (cell(f.currencyCode) || 'EUR').toUpperCase(),
            buyerReference: f.buyerReference ? cell(f.buyerReference) || undefined : undefined,
            note: f.note ? cell(f.note) || undefined : undefined,
            precedingInvoiceId: f.precedingInvoiceId ? cell(f.precedingInvoiceId) || undefined : undefined,
            precedingInvoiceDate: f.precedingInvoiceDate
                ? this.normaliseDate(cell(f.precedingInvoiceDate)) || undefined
                : undefined,
            invoicePeriodStart: f.invoicePeriodStart
                ? this.normaliseDate(cell(f.invoicePeriodStart)) || undefined
                : undefined,
            invoicePeriodEnd: f.invoicePeriodEnd
                ? this.normaliseDate(cell(f.invoicePeriodEnd)) || undefined
                : undefined,
            delivery: deliveryDate || deliveryCountry || deliveryCity || deliveryPostalCode
                ? { actualDeliveryDate: deliveryDate, countryCode: deliveryCountry, city: deliveryCity, postalCode: deliveryPostalCode }
                : undefined,
            seller: this.extractParty(matrix, f.seller),
            buyer: this.extractParty(matrix, f.buyer),
            payment: {
                iban: f.payment.iban ? cell(f.payment.iban) || undefined : undefined,
                bic: f.payment.bic ? cell(f.payment.bic) || undefined : undefined,
                paymentTerms: f.payment.paymentTerms ? cell(f.payment.paymentTerms) || undefined : undefined,
            },
            lines,
            netAmount: round2(netAmount),
            taxAmount: round2(taxAmount),
            grossAmount: round2(netAmount + taxAmount),
        };
    }
    extractParty(matrix, mapping) {
        const cell = (ref) => ref ? this.ss.getCellValue(matrix, ref.row, ref.col) : '';
        return {
            name: cell(mapping.name),
            streetName: cell(mapping.street),
            cityName: cell(mapping.city),
            postalZone: cell(mapping.postalCode),
            countryCode: (cell(mapping.country) || '').toUpperCase(),
            vatNumber: mapping.vatNumber ? cell(mapping.vatNumber) || undefined : undefined,
            registrationName: mapping.registration ? cell(mapping.registration) || undefined : undefined,
            contactName: mapping.contactName ? cell(mapping.contactName) || undefined : undefined,
            contactPhone: mapping.contactPhone ? cell(mapping.contactPhone) || undefined : undefined,
            contactEmail: mapping.contactEmail ? cell(mapping.contactEmail) || undefined : undefined,
            endpointId: mapping.endpointId ? cell(mapping.endpointId) || undefined : undefined,
            endpointSchemeId: mapping.endpointSchemeId || undefined,
        };
    }
    extractLines(matrix, startRow, cols) {
        const lines = [];
        let lineNum = 1;
        for (let row = startRow; row < matrix.length; row++) {
            const rowData = matrix[row];
            if (!rowData)
                continue;
            const description = String(rowData[cols.description] ?? '').trim();
            if (!description)
                break; // first blank description row marks end of contiguous line block
            const quantity = parseFloat(String(rowData[cols.quantity] ?? 0)) || 0;
            const unit = String(rowData[cols.unit] ?? 'C62').trim() || 'C62';
            const unitPrice = parseFloat(String(rowData[cols.unitPrice] ?? 0)) || 0;
            const vatRate = parseFloat(String(rowData[cols.vatRate] ?? 0)) || 0;
            const taxCategoryRaw = cols.taxCategory !== undefined
                ? String(rowData[cols.taxCategory] ?? '').trim()
                : '';
            const taxCategory = VALID_TAX_CATS.has(taxCategoryRaw)
                ? taxCategoryRaw
                : undefined;
            let netAmount;
            if (cols.netAmount !== undefined && rowData[cols.netAmount] !== null) {
                netAmount = parseFloat(String(rowData[cols.netAmount])) || quantity * unitPrice;
            }
            else {
                netAmount = quantity * unitPrice;
            }
            netAmount = round2(netAmount);
            const vatAmount = round2(netAmount * (vatRate / 100));
            logger_1.logger.debug(`Line ${lineNum}: "${description}" qty=${quantity} price=${unitPrice} vat=${vatRate}% cat=${taxCategory ?? 'derived'}`);
            lines.push({ lineNumber: lineNum++, description, quantity, unit, unitPrice, vatRate, taxCategory, netAmount, vatAmount });
        }
        return lines;
    }
    normaliseDate(raw) {
        if (!raw)
            return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
            return raw;
        const match = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (match)
            return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
        const d = new Date(raw);
        if (!isNaN(d.getTime()))
            return d.toISOString().slice(0, 10);
        return raw;
    }
}
exports.MappingService = MappingService;
function round2(n) {
    return Math.round(n * 100) / 100;
}
