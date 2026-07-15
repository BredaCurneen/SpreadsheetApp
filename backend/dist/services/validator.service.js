"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidatorService = void 0;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
/**
 * Full EN16931 / PEPPOL BIS 3 tax category set (UNTDID 5305):
 *   S  – Standard rate
 *   Z  – Zero rated
 *   E  – Exempt from tax
 *   AE – VAT Reverse Charge
 *   K  – Intra-community supply (zero VAT, buyer accounts for VAT)
 *   O  – Outside scope of VAT
 */
const VALID_TAX_CATEGORIES = new Set(['S', 'Z', 'E', 'AE', 'K', 'O']);
/** Categories that must carry a 0 % VAT rate (BR-Z-1, BR-E-1, BR-AE-1, BR-K-1, BR-O-1). */
const ZERO_RATE_CATEGORIES = new Set(['Z', 'E', 'AE', 'K', 'O']);
/**
 * Validates InvoiceData against a subset of EN16931 business rules before
 * UBL generation, then performs arithmetic consistency checks post-generation.
 *
 * To add full Schematron / KoSIT validation, plug in Saxon-JS or spawn the
 * KoSIT validator CLI from this method and merge the errors array.
 */
class ValidatorService {
    validate(invoice) {
        const errors = [];
        // ── Presence rules (BR-xx) ────────────────────────────────────────────
        if (!invoice.id) {
            errors.push(fatal('BR-02', 'Invoice shall have an Invoice number (ID).', '/Invoice/cbc:ID'));
        }
        if (!invoice.issueDate) {
            errors.push(fatal('BR-03', 'Invoice shall have an Invoice issue date.', '/Invoice/cbc:IssueDate'));
        }
        else if (!ISO_DATE_RE.test(invoice.issueDate)) {
            errors.push(fatal('BR-03-FMT', `Issue date "${invoice.issueDate}" is not ISO 8601 (YYYY-MM-DD).`, '/Invoice/cbc:IssueDate'));
        }
        if (invoice.dueDate && !ISO_DATE_RE.test(invoice.dueDate)) {
            errors.push(warn('BR-DUEDATE-FMT', `Due date "${invoice.dueDate}" is not ISO 8601 (YYYY-MM-DD).`, '/Invoice/cbc:DueDate'));
        }
        if (!invoice.typeCode) {
            errors.push(fatal('BR-04', 'Invoice shall have an Invoice type code.', '/Invoice/cbc:InvoiceTypeCode'));
        }
        if (!invoice.currencyCode) {
            errors.push(fatal('BR-05', 'Invoice shall have a Document currency code.', '/Invoice/cbc:DocumentCurrencyCode'));
        }
        else if (!CURRENCY_CODE_RE.test(invoice.currencyCode)) {
            errors.push(fatal('BR-05-FMT', `Currency code "${invoice.currencyCode}" must be ISO 4217 (3 uppercase letters).`, '/Invoice/cbc:DocumentCurrencyCode'));
        }
        // ── Seller (BR-06, BR-08, BR-09, BR-AE-02) ────────────────────────────
        if (!invoice.seller.name) {
            errors.push(fatal('BR-06', 'Invoice shall have a Seller name.', '/Invoice/cac:AccountingSupplierParty/cac:Party'));
        }
        if (!invoice.seller.streetName || !invoice.seller.cityName || !invoice.seller.postalZone) {
            errors.push(fatal('BR-08', 'Seller postal address is incomplete (street, city, postal code required).', '/Invoice/cac:AccountingSupplierParty'));
        }
        if (!invoice.seller.countryCode) {
            errors.push(fatal('BR-09', 'Seller postal address shall have a Country code.', '/Invoice/cac:AccountingSupplierParty'));
        }
        else if (!COUNTRY_CODE_RE.test(invoice.seller.countryCode)) {
            errors.push(fatal('BR-09-FMT', `Seller country code "${invoice.seller.countryCode}" must be ISO 3166-1 alpha-2.`, '/Invoice/cac:AccountingSupplierParty'));
        }
        if (!invoice.seller.vatNumber) {
            errors.push(warn('BR-14', 'Seller VAT identifier is missing. Required unless exempt.', '/Invoice/cac:AccountingSupplierParty'));
        }
        // ── Buyer (BR-07, BR-10, BR-11) ───────────────────────────────────────
        if (!invoice.buyer.name) {
            errors.push(fatal('BR-07', 'Invoice shall have a Buyer name.', '/Invoice/cac:AccountingCustomerParty/cac:Party'));
        }
        if (!invoice.buyer.streetName || !invoice.buyer.cityName || !invoice.buyer.postalZone) {
            errors.push(fatal('BR-10', 'Buyer postal address is incomplete.', '/Invoice/cac:AccountingCustomerParty'));
        }
        if (!invoice.buyer.countryCode) {
            errors.push(fatal('BR-11', 'Buyer postal address shall have a Country code.', '/Invoice/cac:AccountingCustomerParty'));
        }
        else if (!COUNTRY_CODE_RE.test(invoice.buyer.countryCode)) {
            errors.push(fatal('BR-11-FMT', `Buyer country code "${invoice.buyer.countryCode}" must be ISO 3166-1 alpha-2.`, '/Invoice/cac:AccountingCustomerParty'));
        }
        // ── Lines (BR-12, BR-13, BR-16, BR-24, BR-25) ────────────────────────
        if (invoice.lines.length === 0) {
            errors.push(fatal('BR-12', 'Invoice shall have at least one Invoice line.', '/Invoice/cac:InvoiceLine'));
        }
        for (const line of invoice.lines) {
            const loc = `/Invoice/cac:InvoiceLine[${line.lineNumber}]`;
            if (!line.description) {
                errors.push(fatal('BR-24', `Line ${line.lineNumber}: item name (description) is missing.`, loc));
            }
            if (!line.quantity) {
                errors.push(fatal('BR-15', `Line ${line.lineNumber}: invoiced quantity shall not be zero.`, loc));
            }
            if (line.unitPrice <= 0) {
                errors.push(fatal('BR-26', `Line ${line.lineNumber}: item net price shall be greater than zero.`, loc));
            }
            if (line.taxCategory !== undefined) {
                if (!VALID_TAX_CATEGORIES.has(line.taxCategory)) {
                    errors.push(fatal('BR-CAT', `Line ${line.lineNumber}: "${line.taxCategory}" is not a valid EN16931 tax category. Allowed: S, Z, E, AE, K, O.`, loc));
                }
                else if (ZERO_RATE_CATEGORIES.has(line.taxCategory) && line.vatRate !== 0) {
                    errors.push(fatal(`BR-${line.taxCategory}-1`, `Line ${line.lineNumber}: category "${line.taxCategory}" requires 0% VAT rate, got ${line.vatRate}%.`, loc));
                }
            }
        }
        // ── Arithmetic (BR-CO-15) ─────────────────────────────────────────────
        const computedNet = round2(invoice.lines.reduce((s, l) => s + l.netAmount, 0));
        const computedTax = round2(invoice.lines.reduce((s, l) => s + l.vatAmount, 0));
        const computedGross = round2(computedNet + computedTax);
        if (Math.abs(computedNet - invoice.netAmount) > 0.02) {
            errors.push(fatal('BR-CO-10', `Net amount mismatch: lines sum to ${computedNet}, header states ${invoice.netAmount}.`, '/Invoice/cac:LegalMonetaryTotal'));
        }
        if (Math.abs(computedGross - invoice.grossAmount) > 0.02) {
            errors.push(fatal('BR-CO-15', `Gross amount mismatch: computed ${computedGross}, header states ${invoice.grossAmount}.`, '/Invoice/cac:LegalMonetaryTotal'));
        }
        return errors;
    }
    hasFatals(errors) {
        return errors.some((e) => e.severity === 'fatal');
    }
}
exports.ValidatorService = ValidatorService;
function fatal(code, message, location) {
    return { code, severity: 'fatal', message, location };
}
function warn(code, message, location) {
    return { code, severity: 'warning', message, location };
}
function round2(n) {
    return Math.round(n * 100) / 100;
}
