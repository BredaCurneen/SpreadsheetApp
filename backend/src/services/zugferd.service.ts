import { XMLParser } from 'fast-xml-parser';
import { PDFDocument, StandardFonts, rgb, PDFFont } from 'pdf-lib';
import { Invoice, InvoiceService, InvoiceServiceOptions, Logger } from '@e-invoice-eu/core';
import { InvoiceData, InvoiceLineItem, InvoiceParty } from '../types/invoice.types';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

// ZUGFeRD and Factur-X are the same technical standard (CII XML embedded in a
// PDF/A-3) since ZUGFeRD 2.0 — @e-invoice-eu/core recognises this directly:
// its FormatFactoryService normalizes any 'ZUGFeRD-*' format string to
// 'factur-x-*' internally. There is no separate @e-invoice-eu/zugferd package;
// this is the real, documented behaviour of @e-invoice-eu/core's format factory.
const ZUGFERD_FORMAT = 'ZUGFeRD-EN16931';

const einvoiceLogger: Logger = {
  log: (m: string) => logger.info(m),
  warn: (m: string) => logger.warn(m),
  error: (m: string) => logger.error(m),
};

function badRequest(message: string): AppError {
  const err: AppError = new Error(message);
  err.statusCode = 400;
  return err;
}

export class ZugferdService {
  private readonly invoiceService = new InvoiceService(einvoiceLogger);

  /**
   * Generates a ZUGFeRD PDF/A-3 (EN16931 profile, CII syntax) from the UBL XML
   * the app already produces, via @e-invoice-eu/core's real InvoiceService.
   * The library embeds the CII XML into a supplied visual PDF with the correct
   * AFRelationship=Alternative, XMP/fx: metadata, and a bundled real sRGB
   * OutputIntent — all handled internally, not reimplemented here.
   */
  async generate(ublXml: string): Promise<Buffer> {
    const invoiceData = parseUblToInvoiceData(ublXml);
    const einvoice = toEInvoiceEuInvoice(invoiceData);
    const visualPdf = await renderVisualPdf(invoiceData);

    const options: InvoiceServiceOptions = {
      format: ZUGFERD_FORMAT,
      lang: 'en',
      pdf: {
        buffer: visualPdf,
        filename: `invoice-${invoiceData.id}.pdf`,
        mimetype: 'application/pdf',
      },
    };

    try {
      const result = await this.invoiceService.generate(einvoice, options);
      return Buffer.from(result as Uint8Array);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ZUGFeRD PDF generation failed.';
      throw badRequest(`ZUGFeRD PDF generation failed: ${message}`);
    }
  }
}

// ── UBL → InvoiceData (same reversal approach as facturx.service.ts /
//    xrechnung.service.ts, kept self-contained here). ─────────────────────────

const ublParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'InvoiceLine' || name === 'TaxSubtotal',
});

function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String((node as Record<string, unknown>)['#text'] ?? '');
  return String(node);
}

function attrOf(node: unknown, attr: string): string | undefined {
  if (node && typeof node === 'object') {
    const value = (node as Record<string, unknown>)[attr];
    return value === undefined ? undefined : String(value);
  }
  return undefined;
}

function num(node: unknown): number {
  const text = textOf(node);
  return text ? parseFloat(text) : 0;
}

function parseUblParty(partyEl: Record<string, unknown>): InvoiceParty {
  const address = (partyEl['PostalAddress'] as Record<string, unknown>) ?? {};
  const country = (address['Country'] as Record<string, unknown>) ?? {};
  const partyName = (partyEl['PartyName'] as Record<string, unknown>) ?? {};
  const legal = (partyEl['PartyLegalEntity'] as Record<string, unknown>) ?? {};
  const taxScheme = partyEl['PartyTaxScheme'] as Record<string, unknown> | undefined;
  const contact = partyEl['Contact'] as Record<string, unknown> | undefined;

  return {
    name: textOf(partyName['Name']),
    streetName: textOf(address['StreetName']),
    cityName: textOf(address['CityName']),
    postalZone: textOf(address['PostalZone']),
    countryCode: textOf(country['IdentificationCode']),
    vatNumber: taxScheme ? textOf(taxScheme['CompanyID']) || undefined : (textOf(legal['CompanyID']) || undefined),
    registrationName: textOf(legal['RegistrationName']) || undefined,
    contactName: contact ? textOf(contact['Name']) || undefined : undefined,
    contactPhone: contact ? textOf(contact['Telephone']) || undefined : undefined,
    contactEmail: contact ? textOf(contact['ElectronicMail']) || undefined : undefined,
  };
}

function parseUblToInvoiceData(xml: string): InvoiceData {
  const parsed = ublParser.parse(xml) as Record<string, unknown>;
  const inv = parsed['Invoice'] as Record<string, unknown>;
  if (!inv) {
    throw badRequest('Input XML is not a valid UBL Invoice document.');
  }

  const supplierParty = (inv['AccountingSupplierParty'] as Record<string, unknown>)['Party'] as Record<string, unknown>;
  const customerParty = (inv['AccountingCustomerParty'] as Record<string, unknown>)['Party'] as Record<string, unknown>;

  const period = inv['InvoicePeriod'] as Record<string, unknown> | undefined;
  const billingRef = inv['BillingReference'] as Record<string, unknown> | undefined;
  const invoiceDocRef = billingRef ? (billingRef['InvoiceDocumentReference'] as Record<string, unknown>) : undefined;

  const delivery = inv['Delivery'] as Record<string, unknown> | undefined;
  const deliveryLocation = delivery ? (delivery['DeliveryLocation'] as Record<string, unknown> | undefined) : undefined;
  const deliveryAddress = deliveryLocation ? (deliveryLocation['Address'] as Record<string, unknown> | undefined) : undefined;
  const deliveryCountry = deliveryAddress ? (deliveryAddress['Country'] as Record<string, unknown> | undefined) : undefined;

  const paymentMeans = inv['PaymentMeans'] as Record<string, unknown> | undefined;
  const payeeAccount = paymentMeans ? (paymentMeans['PayeeFinancialAccount'] as Record<string, unknown> | undefined) : undefined;
  const financialBranch = payeeAccount ? (payeeAccount['FinancialInstitutionBranch'] as Record<string, unknown> | undefined) : undefined;
  const paymentTerms = inv['PaymentTerms'] as Record<string, unknown> | undefined;

  const taxTotal = inv['TaxTotal'] as Record<string, unknown>;
  const totals = inv['LegalMonetaryTotal'] as Record<string, unknown>;

  const rawLines = (inv['InvoiceLine'] as Record<string, unknown>[]) ?? [];
  const lines: InvoiceLineItem[] = rawLines.map((line) => {
    const quantityNode = line['InvoicedQuantity'];
    const item = line['Item'] as Record<string, unknown>;
    const classifiedTax = item['ClassifiedTaxCategory'] as Record<string, unknown>;
    const price = line['Price'] as Record<string, unknown>;
    const vatRate = num(classifiedTax['Percent']);
    const netAmount = num(line['LineExtensionAmount']);

    return {
      lineNumber: parseInt(textOf(line['ID']), 10),
      description: textOf(item['Description']) || textOf(item['Name']),
      quantity: num(quantityNode),
      unit: attrOf(quantityNode, 'unitCode') ?? 'C62',
      unitPrice: num(price['PriceAmount']),
      vatRate,
      taxCategory: (textOf(classifiedTax['ID']) || undefined) as InvoiceLineItem['taxCategory'],
      netAmount,
      vatAmount: Math.round(netAmount * (vatRate / 100) * 100) / 100,
    };
  });

  if (lines.length === 0) {
    throw badRequest('UBL invoice has no invoice lines — cannot generate a ZUGFeRD PDF.');
  }

  return {
    id: textOf(inv['ID']),
    issueDate: textOf(inv['IssueDate']),
    dueDate: textOf(inv['DueDate']) || undefined,
    typeCode: textOf(inv['InvoiceTypeCode']) || '380',
    currencyCode: textOf(inv['DocumentCurrencyCode']),
    buyerReference: textOf(inv['BuyerReference']) || undefined,
    note: textOf(inv['Note']) || undefined,
    precedingInvoiceId: invoiceDocRef ? textOf(invoiceDocRef['ID']) || undefined : undefined,
    precedingInvoiceDate: invoiceDocRef ? textOf(invoiceDocRef['IssueDate']) || undefined : undefined,
    invoicePeriodStart: period ? textOf(period['StartDate']) || undefined : undefined,
    invoicePeriodEnd: period ? textOf(period['EndDate']) || undefined : undefined,
    delivery: delivery
      ? {
          actualDeliveryDate: textOf(delivery['ActualDeliveryDate']) || undefined,
          countryCode: deliveryCountry ? textOf(deliveryCountry['IdentificationCode']) || undefined : undefined,
          city: deliveryAddress ? textOf(deliveryAddress['CityName']) || undefined : undefined,
          postalCode: deliveryAddress ? textOf(deliveryAddress['PostalZone']) || undefined : undefined,
        }
      : undefined,
    seller: parseUblParty(supplierParty),
    buyer: parseUblParty(customerParty),
    payment: {
      iban: payeeAccount ? textOf(payeeAccount['ID']) || undefined : undefined,
      bic: financialBranch ? textOf(financialBranch['ID']) || undefined : undefined,
      paymentTerms: paymentTerms ? textOf(paymentTerms['Note']) || undefined : undefined,
    },
    lines,
    taxAmount: num(taxTotal['TaxAmount']),
    netAmount: num(totals['LineExtensionAmount']),
    grossAmount: num(totals['PayableAmount']),
  };
}

// ── InvoiceData → @e-invoice-eu/core's `Invoice` JSON model ──────────────────
// (Identical mapping to xrechnung.service.ts, including the BR-S-02/BR-Z-02/
// BR-AE-02 fix: VAT numbers go into `cac:PartyTaxScheme`, not
// `cac:PartyLegalEntity/cbc:CompanyID` — duplicated here to keep this service
// self-contained rather than importing from the sibling service file.)

interface TaxGroup {
  category: string;
  rate: number;
  netAmount: number;
  vatAmount: number;
}

const TAX_EXEMPTION: Record<string, { code: string; reason: string }> = {
  AE: { code: 'VATEX-EU-AE', reason: 'Reverse charge' },
  K: { code: 'VATEX-EU-IC', reason: 'Intra-community supply' },
  E: { code: 'VATEX-EU-79-C', reason: 'Exempt based on article 132 of Council Directive 2006/112/EC' },
  O: { code: 'VATEX-EU-O', reason: 'Not subject to VAT' },
};

function groupByTax(lines: InvoiceLineItem[]): Map<string, TaxGroup> {
  const map = new Map<string, TaxGroup>();
  for (const line of lines) {
    const category = line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z');
    const key = `${category}:${line.vatRate}`;
    const group = map.get(key) ?? { category, rate: line.vatRate, netAmount: 0, vatAmount: 0 };
    group.netAmount = Math.round((group.netAmount + line.netAmount) * 100) / 100;
    group.vatAmount = Math.round((group.vatAmount + line.vatAmount) * 100) / 100;
    map.set(key, group);
  }
  return map;
}

function basePartyFields(party: InvoiceParty) {
  return {
    'cac:PartyName': { 'cbc:Name': party.name },
    'cac:PostalAddress': {
      'cbc:StreetName': party.streetName,
      'cbc:CityName': party.cityName,
      'cbc:PostalZone': party.postalZone,
      'cac:Country': { 'cbc:IdentificationCode': party.countryCode },
    },
    ...(party.contactName || party.contactPhone || party.contactEmail
      ? {
          'cac:Contact': {
            ...(party.contactName ? { 'cbc:Name': party.contactName } : {}),
            ...(party.contactPhone ? { 'cbc:Telephone': party.contactPhone } : {}),
            ...(party.contactEmail ? { 'cbc:ElectronicMail': party.contactEmail } : {}),
          },
        }
      : {}),
  };
}

/** BR-S-02 / BR-Z-02 / BR-AE-02: Seller VAT ID must be in `cac:PartyTaxScheme`. */
function buildSellerParty(party: InvoiceParty) {
  const sellerVatId = party.vatNumber;
  if (!sellerVatId) {
    logger.warn(
      `Seller "${party.name}" has no VAT number — using placeholder tax ID "NA" to satisfy BR-S-02/BR-Z-02/BR-AE-02. ` +
        'Provide a Seller VAT ID in the spreadsheet to avoid this.',
    );
  }

  return {
    ...basePartyFields(party),
    'cac:PartyTaxScheme': [
      {
        'cbc:CompanyID': sellerVatId || 'NA',
        'cac:TaxScheme': { 'cbc:ID': 'VAT' },
      },
    ],
    'cac:PartyLegalEntity': {
      'cbc:RegistrationName': party.registrationName ?? party.name,
    },
  };
}

/** BR-AE-02 buyer side accepts Buyer VAT ID OR Buyer Legal Registration ID. */
function buildBuyerParty(party: InvoiceParty) {
  const buyerVatId = party.vatNumber;
  if (!buyerVatId) {
    logger.warn(
      `Buyer "${party.name}" has no VAT number — using placeholder legal registration ID "NA" to satisfy BR-AE-02. ` +
        'Provide a Buyer VAT ID (or a real legal registration ID) in the spreadsheet to avoid this.',
    );
  }

  return {
    ...basePartyFields(party),
    ...(buyerVatId
      ? {
          'cac:PartyTaxScheme': {
            'cbc:CompanyID': buyerVatId,
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        }
      : {}),
    'cac:PartyLegalEntity': {
      'cbc:RegistrationName': party.registrationName ?? party.name,
      ...(buyerVatId ? {} : { 'cbc:CompanyID': 'NA' }),
    },
  };
}

function toEInvoiceEuInvoice(invoice: InvoiceData): Invoice {
  const hasIntraCommunitySupply = invoice.lines.some(
    (line) => (line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z')) === 'K',
  );
  const deliverToCountry = invoice.delivery?.countryCode || invoice.seller.countryCode || 'IE';

  const taxSubtotals = [...groupByTax(invoice.lines).values()].map((group) => {
    const exemption = TAX_EXEMPTION[group.category];
    return {
      'cbc:TaxableAmount': group.netAmount.toFixed(2),
      'cbc:TaxableAmount@currencyID': invoice.currencyCode,
      'cbc:TaxAmount': group.vatAmount.toFixed(2),
      'cbc:TaxAmount@currencyID': invoice.currencyCode,
      'cac:TaxCategory': {
        'cbc:ID': group.category,
        'cbc:Percent': group.rate.toString(),
        ...(exemption
          ? { 'cbc:TaxExemptionReasonCode': exemption.code, 'cbc:TaxExemptionReason': exemption.reason }
          : {}),
        'cac:TaxScheme': { 'cbc:ID': 'VAT' },
      },
    };
  });

  const invoiceLines = invoice.lines.map((line) => {
    const category = line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z');
    return {
      'cbc:ID': line.lineNumber.toString(),
      'cbc:InvoicedQuantity': line.quantity.toString(),
      'cbc:InvoicedQuantity@unitCode': line.unit,
      'cbc:LineExtensionAmount': line.netAmount.toFixed(2),
      'cbc:LineExtensionAmount@currencyID': invoice.currencyCode,
      'cac:Item': {
        'cbc:Name': line.description,
        'cac:ClassifiedTaxCategory': {
          'cbc:ID': category,
          'cbc:Percent': line.vatRate.toString(),
          'cac:TaxScheme': { 'cbc:ID': 'VAT' },
        },
      },
      'cac:Price': {
        'cbc:PriceAmount': line.unitPrice.toFixed(2),
        'cbc:PriceAmount@currencyID': invoice.currencyCode,
      },
    };
  }) as unknown as Invoice['ubl:Invoice']['cac:InvoiceLine'];

  const draft: Record<string, unknown> = {
    'cbc:ID': invoice.id,
    'cbc:IssueDate': invoice.issueDate,
    ...(invoice.dueDate ? { 'cbc:DueDate': invoice.dueDate } : {}),
    'cbc:InvoiceTypeCode': invoice.typeCode,
    ...(invoice.note ? { 'cbc:Note': [invoice.note] } : {}),
    'cbc:DocumentCurrencyCode': invoice.currencyCode,
    ...(invoice.buyerReference ? { 'cbc:BuyerReference': invoice.buyerReference } : {}),
    ...(invoice.invoicePeriodStart || invoice.invoicePeriodEnd
      ? {
          'cac:InvoicePeriod': {
            ...(invoice.invoicePeriodStart ? { 'cbc:StartDate': invoice.invoicePeriodStart } : {}),
            ...(invoice.invoicePeriodEnd ? { 'cbc:EndDate': invoice.invoicePeriodEnd } : {}),
          },
        }
      : {}),
    ...(invoice.typeCode === '384' && invoice.precedingInvoiceId
      ? {
          'cac:BillingReference': [
            {
              'cac:InvoiceDocumentReference': {
                'cbc:ID': invoice.precedingInvoiceId,
                ...(invoice.precedingInvoiceDate ? { 'cbc:IssueDate': invoice.precedingInvoiceDate } : {}),
              },
            },
          ],
        }
      : {}),
    'cac:AccountingSupplierParty': { 'cac:Party': buildSellerParty(invoice.seller) },
    'cac:AccountingCustomerParty': { 'cac:Party': buildBuyerParty(invoice.buyer) },
    ...(hasIntraCommunitySupply || invoice.delivery?.actualDeliveryDate
      ? {
          'cac:Delivery': {
            ...(invoice.delivery?.actualDeliveryDate
              ? { 'cbc:ActualDeliveryDate': invoice.delivery.actualDeliveryDate }
              : {}),
            ...(hasIntraCommunitySupply
              ? { 'cac:DeliveryLocation': { 'cac:Address': { 'cac:Country': { 'cbc:IdentificationCode': deliverToCountry } } } }
              : {}),
          },
        }
      : {}),
    ...(invoice.payment.iban
      ? {
          'cac:PaymentMeans': [
            {
              'cbc:PaymentMeansCode': '30',
              'cac:PayeeFinancialAccount': {
                'cbc:ID': invoice.payment.iban,
                ...(invoice.payment.bic
                  ? { 'cac:FinancialInstitutionBranch': { 'cbc:ID': invoice.payment.bic } }
                  : {}),
              },
            },
          ],
        }
      : {}),
    ...(invoice.payment.paymentTerms ? { 'cac:PaymentTerms': { 'cbc:Note': invoice.payment.paymentTerms } } : {}),
    'cac:TaxTotal': [
      {
        'cbc:TaxAmount': invoice.taxAmount.toFixed(2),
        'cbc:TaxAmount@currencyID': invoice.currencyCode,
        'cac:TaxSubtotal': taxSubtotals,
      },
    ],
    'cac:LegalMonetaryTotal': {
      'cbc:LineExtensionAmount': invoice.netAmount.toFixed(2),
      'cbc:LineExtensionAmount@currencyID': invoice.currencyCode,
      'cbc:TaxExclusiveAmount': invoice.netAmount.toFixed(2),
      'cbc:TaxExclusiveAmount@currencyID': invoice.currencyCode,
      'cbc:TaxInclusiveAmount': invoice.grossAmount.toFixed(2),
      'cbc:TaxInclusiveAmount@currencyID': invoice.currencyCode,
      'cbc:PayableAmount': invoice.grossAmount.toFixed(2),
      'cbc:PayableAmount@currencyID': invoice.currencyCode,
    },
    'cac:InvoiceLine': invoiceLines,
  };

  return { 'ubl:Invoice': draft } as unknown as Invoice;
}

// ── Minimal visual PDF (fed to @e-invoice-eu/core as `options.pdf`) ──────────
// The library embeds the CII XML into a PDF it's given — it doesn't render one
// from scratch unless a LibreOffice path + spreadsheet buffer are supplied
// (`getInvoicePdf()` in its FormatXMLService). Rather than depend on a
// LibreOffice install, this renders a small human-readable summary page with
// pdf-lib directly, matching the visual-representation approach already used
// in facturx.service.ts.

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4 in points
const MARGIN = 50;

async function renderVisualPdf(invoice: InvoiceData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;
  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.4, 0.45, 0.52);
  const accent = rgb(0.39, 0.4, 0.95);

  const write = (text: string, size: number, useFont: PDFFont, color = dark): void => {
    page.drawText(text, { x: MARGIN, y, size, font: useFont, color });
    y -= size + 8;
  };

  write('INVOICE', 22, boldFont, accent);
  write(`ZUGFeRD / PDF-A-3 · EN 16931`, 9, font, gray);
  y -= 8;
  write(`Invoice ${invoice.id}`, 12, boldFont);
  write(`Issue date: ${invoice.issueDate}`, 10, font, gray);
  y -= 10;

  write('SELLER', 8, boldFont, gray);
  write(invoice.seller.name, 10, font, dark);
  write(`${invoice.seller.streetName}, ${invoice.seller.postalZone} ${invoice.seller.cityName}, ${invoice.seller.countryCode}`, 9, font, gray);
  y -= 10;

  write('BILL TO', 8, boldFont, gray);
  write(invoice.buyer.name, 10, font, dark);
  write(`${invoice.buyer.streetName}, ${invoice.buyer.postalZone} ${invoice.buyer.cityName}, ${invoice.buyer.countryCode}`, 9, font, gray);
  y -= 10;

  write('LINE ITEMS', 8, boldFont, gray);
  for (const line of invoice.lines) {
    write(
      `${line.description} — ${line.quantity} x ${line.unitPrice.toFixed(2)} @ ${line.vatRate}% = ${line.netAmount.toFixed(2)} ${invoice.currencyCode}`,
      9,
      font,
      dark,
    );
  }
  y -= 10;

  write(`Net amount:    ${invoice.netAmount.toFixed(2)} ${invoice.currencyCode}`, 9, font, gray);
  write(`VAT amount:    ${invoice.taxAmount.toFixed(2)} ${invoice.currencyCode}`, 9, font, gray);
  write(`Total payable: ${invoice.grossAmount.toFixed(2)} ${invoice.currencyCode}`, 10, boldFont, dark);

  return pdfDoc.save();
}
