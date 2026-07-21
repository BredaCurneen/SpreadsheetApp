import { XMLParser } from 'fast-xml-parser';
import { Invoice, InvoiceService, InvoiceServiceOptions, Logger } from '@e-invoice-eu/core';
import { InvoiceData, InvoiceLineItem, InvoiceParty } from '../types/invoice.types';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

// XRechnung is a German EN16931 profile that can be expressed in either UBL or CII
// syntax; this generator uses the CII binding, which — unlike UBL — doesn't require
// a PEPPOL EndpointID on each party, keeping the JSON mapping below simpler.
const XRECHNUNG_FORMAT = 'XRECHNUNG-CII';

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

export class XRechnungService {
  private readonly invoiceService = new InvoiceService(einvoiceLogger);

  /**
   * Generates XRechnung XML (EN16931, CII syntax) from the UBL XML the app
   * already produces, via @e-invoice-eu/core's real InvoiceService.
   */
  async generate(ublXml: string): Promise<string> {
    const invoiceData = parseUblToInvoiceData(ublXml);
    const einvoice = toEInvoiceEuInvoice(invoiceData);
    const options: InvoiceServiceOptions = { format: XRECHNUNG_FORMAT, lang: 'en' };

    try {
      const result = await this.invoiceService.generate(einvoice, options);
      return typeof result === 'string' ? result : Buffer.from(result).toString('utf-8');
    } catch (err) {
      // @e-invoice-eu/core throws Ajv ValidationError (or similar) for schema violations —
      // those are caller/data problems (400), not server faults.
      const message = err instanceof Error ? err.message : 'XRechnung generation failed.';
      throw badRequest(`XRechnung XML generation failed: ${message}`);
    }
  }
}

// ── UBL → InvoiceData (same reversal approach as facturx.service.ts, kept
//    self-contained here rather than importing from that file). ─────────────

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
    throw badRequest('UBL invoice has no invoice lines — cannot generate XRechnung XML.');
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

/**
 * BR-S-02 / BR-Z-02 / BR-AE-02 require the Seller VAT identifier (BT-31) to be
 * carried in `cac:PartyTaxScheme` (→ CII `SpecifiedTaxRegistration`), NOT in
 * `cac:PartyLegalEntity/cbc:CompanyID` (BT-30, a different business term — the
 * legal registration number). Putting the VAT number there was the bug: the
 * library still emitted a company ID, just in the element none of those rules
 * check, so it generated `SpecifiedLegalOrganization` instead of
 * `SpecifiedTaxRegistration` and every one of those rules failed.
 *
 * If the spreadsheet provides no seller VAT number at all, there's no other
 * real field in this app's data model (no separate "tax registration number"
 * or "tax representative" column) to fall back to, so — per the requested
 * fallback chain's last resort — this falls back to the literal placeholder
 * "NA" rather than silently omitting the element and failing validation again.
 */
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

/**
 * BR-AE-02's buyer-side condition accepts either the Buyer VAT identifier
 * (BT-48, `cac:PartyTaxScheme`) or the Buyer legal registration identifier
 * (BT-47, `cac:PartyLegalEntity/cbc:CompanyID`) — unlike the seller side,
 * both are valid here, so the buyer VAT number is mapped to the correct
 * `PartyTaxScheme` element and the legal-entity `CompanyID` is only used as
 * the last-resort placeholder when no VAT number is present.
 */
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

  // The library's own ajv schema (with useDefaults) is the real validation gate at
  // runtime — casting here just bridges our flat InvoiceData model to its UBL-keyed
  // JSON shape without redeclaring that ~2000-line schema type by hand.
  return { 'ubl:Invoice': draft } as unknown as Invoice;
}
