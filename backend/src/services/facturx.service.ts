import fs from 'fs';
import path from 'path';
import { create } from 'xmlbuilder2';
import { XMLParser } from 'fast-xml-parser';
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
  AFRelationship,
  PDFFont,
} from 'pdf-lib';
import { InvoiceData, InvoiceLineItem, InvoiceParty } from '../types/invoice.types';
import { logger } from '../utils/logger';

// ── CII (UN/CEFACT Cross Industry Invoice) namespaces ─────────────────────────
// Factur-X embeds CII XML, not UBL — this is a distinct syntax for the same
// EN16931 semantic invoice model that the app's existing UBL generator targets.
const CII_NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
};

const FACTURX_GUIDELINE_ID = 'urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931';
const FACTURX_ATTACHMENT_NAME = 'factur-x.xml';

// Same UNTDID-5305 tax exemption metadata as ubl.service.ts (BR-AE-10 / BR-IC-10 / BR-E-10 / BR-O-10).
const TAX_EXEMPTION: Record<string, { code: string; reason: string }> = {
  AE: { code: 'VATEX-EU-AE', reason: 'Reverse charge' },
  K: { code: 'VATEX-EU-IC', reason: 'Intra-community supply' },
  E: { code: 'VATEX-EU-79-C', reason: 'Exempt based on article 132 of Council Directive 2006/112/EC' },
  O: { code: 'VATEX-EU-O', reason: 'Not subject to VAT' },
};

const ICC_PROFILE_PATH = path.join(__dirname, '../../assets/sRGB.icc');

interface TaxGroup {
  category: string;
  rate: number;
  netAmount: number;
  vatAmount: number;
}

export class FacturxService {
  /**
   * Generates a Factur-X (PDF/A-3) invoice from the UBL XML the app already
   * produces. The UBL is parsed back into structured invoice data, re-expressed
   * as CII XML (the syntax Factur-X actually requires), and embedded into a
   * PDF alongside a human-readable visual representation.
   */
  async generatePdf(ublXml: string): Promise<Buffer> {
    const invoice = parseUblToInvoiceData(ublXml);
    const ciiXml = buildCiiXml(invoice);
    const pdfBytes = await buildFacturXPdf(invoice, ciiXml);
    return Buffer.from(pdfBytes);
  }
}

// ── UBL → InvoiceData (reverse of ubl.service.ts) ─────────────────────────────

const ublParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'InvoiceLine' || name === 'TaxSubtotal',
});

/** Reads the text content of a parsed node, whether it's a bare value or `{ '#text', ...attrs }`. */
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
  const endpoint = partyEl['EndpointID'];

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
    endpointId: endpoint ? textOf(endpoint) || undefined : undefined,
    endpointSchemeId: endpoint ? attrOf(endpoint, 'schemeID') : undefined,
  };
}

function parseUblToInvoiceData(xml: string): InvoiceData {
  const parsed = ublParser.parse(xml) as Record<string, unknown>;
  const inv = parsed['Invoice'] as Record<string, unknown>;
  if (!inv) {
    throw new Error('Input XML is not a valid UBL Invoice document.');
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
      // UBL doesn't carry a per-line VAT amount field — derive it from the rate (BR-CO-17 style).
      vatAmount: Math.round(netAmount * (vatRate / 100) * 100) / 100,
    };
  });

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

// ── InvoiceData → CII XML (Factur-X EN16931 profile) ──────────────────────────

function toCiiDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

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

function buildCiiParty(root: ReturnType<typeof create>, tag: string, party: InvoiceParty): void {
  const el = root.ele(tag);
  el.ele('ram:Name').txt(party.name);
  const address = el.ele('ram:PostalTradeAddress');
  if (party.postalZone) address.ele('ram:PostcodeCode').txt(party.postalZone);
  address.ele('ram:LineOne').txt(party.streetName);
  address.ele('ram:CityName').txt(party.cityName);
  address.ele('ram:CountryID').txt(party.countryCode);
  if (party.vatNumber) {
    el.ele('ram:SpecifiedTaxRegistration').ele('ram:ID', { schemeID: 'VA' }).txt(party.vatNumber);
  }
}

function buildCiiXml(invoice: InvoiceData): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('rsm:CrossIndustryInvoice', {
    'xmlns:rsm': CII_NS.rsm,
    'xmlns:ram': CII_NS.ram,
    'xmlns:udt': CII_NS.udt,
  });

  root
    .ele('rsm:ExchangedDocumentContext')
    .ele('ram:GuidelineSpecifiedDocumentContextParameter')
    .ele('ram:ID')
    .txt(FACTURX_GUIDELINE_ID);

  const doc = root.ele('rsm:ExchangedDocument');
  doc.ele('ram:ID').txt(invoice.id);
  doc.ele('ram:TypeCode').txt(invoice.typeCode);
  doc.ele('ram:IssueDateTime').ele('udt:DateTimeString', { format: '102' }).txt(toCiiDate(invoice.issueDate));
  if (invoice.note) {
    doc.ele('ram:IncludedNote').ele('ram:Content').txt(invoice.note);
  }

  const transaction = root.ele('rsm:SupplyChainTradeTransaction');

  for (const line of invoice.lines) {
    const category = line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z');
    const lineEl = transaction.ele('ram:IncludedSupplyChainTradeLineItem');
    lineEl.ele('ram:AssociatedDocumentLineDocument').ele('ram:LineID').txt(line.lineNumber.toString());
    lineEl.ele('ram:SpecifiedTradeProduct').ele('ram:Name').txt(line.description);

    lineEl
      .ele('ram:SpecifiedLineTradeAgreement')
      .ele('ram:NetPriceProductTradePrice')
      .ele('ram:ChargeAmount')
      .txt(line.unitPrice.toFixed(2));

    lineEl
      .ele('ram:SpecifiedLineTradeDelivery')
      .ele('ram:BilledQuantity', { unitCode: line.unit })
      .txt(line.quantity.toString());

    const lineSettlement = lineEl.ele('ram:SpecifiedLineTradeSettlement');
    const lineTax = lineSettlement.ele('ram:ApplicableTradeTax');
    lineTax.ele('ram:TypeCode').txt('VAT');
    lineTax.ele('ram:CategoryCode').txt(category);
    lineTax.ele('ram:RateApplicablePercent').txt(line.vatRate.toString());
    lineSettlement
      .ele('ram:SpecifiedTradeSettlementLineMonetarySummation')
      .ele('ram:LineTotalAmount')
      .txt(line.netAmount.toFixed(2));
  }

  const agreement = transaction.ele('ram:ApplicableHeaderTradeAgreement');
  if (invoice.buyerReference) {
    agreement.ele('ram:BuyerReference').txt(invoice.buyerReference);
  }
  buildCiiParty(agreement, 'ram:SellerTradeParty', invoice.seller);
  buildCiiParty(agreement, 'ram:BuyerTradeParty', invoice.buyer);

  const deliveryEl = transaction.ele('ram:ApplicableHeaderTradeDelivery');
  if (invoice.delivery?.actualDeliveryDate) {
    deliveryEl
      .ele('ram:ActualDeliverySupplyChainEvent')
      .ele('ram:OccurrenceDateTime')
      .ele('udt:DateTimeString', { format: '102' })
      .txt(toCiiDate(invoice.delivery.actualDeliveryDate));
  }

  const settlement = transaction.ele('ram:ApplicableHeaderTradeSettlement');
  settlement.ele('ram:InvoiceCurrencyCode').txt(invoice.currencyCode);

  if (invoice.payment.iban) {
    const means = settlement.ele('ram:SpecifiedTradeSettlementPaymentMeans');
    means.ele('ram:TypeCode').txt('30');
    means.ele('ram:PayeePartyCreditorFinancialAccount').ele('ram:IBANID').txt(invoice.payment.iban);
    if (invoice.payment.bic) {
      means.ele('ram:PayeeSpecifiedCreditorFinancialInstitution').ele('ram:BICID').txt(invoice.payment.bic);
    }
  }

  for (const group of groupByTax(invoice.lines).values()) {
    const tax = settlement.ele('ram:ApplicableTradeTax');
    tax.ele('ram:CalculatedAmount').txt(group.vatAmount.toFixed(2));
    tax.ele('ram:TypeCode').txt('VAT');
    const exemption = TAX_EXEMPTION[group.category];
    if (exemption) {
      tax.ele('ram:ExemptionReasonCode').txt(exemption.code);
      tax.ele('ram:ExemptionReason').txt(exemption.reason);
    }
    tax.ele('ram:BasisAmount').txt(group.netAmount.toFixed(2));
    tax.ele('ram:CategoryCode').txt(group.category);
    tax.ele('ram:RateApplicablePercent').txt(group.rate.toString());
  }

  if (invoice.invoicePeriodStart || invoice.invoicePeriodEnd) {
    const billingPeriod = settlement.ele('ram:BillingSpecifiedPeriod');
    if (invoice.invoicePeriodStart) {
      billingPeriod.ele('ram:StartDateTime').ele('udt:DateTimeString', { format: '102' }).txt(toCiiDate(invoice.invoicePeriodStart));
    }
    if (invoice.invoicePeriodEnd) {
      billingPeriod.ele('ram:EndDateTime').ele('udt:DateTimeString', { format: '102' }).txt(toCiiDate(invoice.invoicePeriodEnd));
    }
  }

  if (invoice.payment.paymentTerms) {
    settlement.ele('ram:SpecifiedTradePaymentTerms').ele('ram:Description').txt(invoice.payment.paymentTerms);
  }

  if (invoice.typeCode === '384' && invoice.precedingInvoiceId) {
    const precedingRef = settlement.ele('ram:InvoiceReferencedDocument');
    precedingRef.ele('ram:IssuerAssignedID').txt(invoice.precedingInvoiceId);
  }

  const summation = settlement.ele('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
  summation.ele('ram:LineTotalAmount').txt(invoice.netAmount.toFixed(2));
  summation.ele('ram:TaxBasisTotalAmount').txt(invoice.netAmount.toFixed(2));
  summation.ele('ram:TaxTotalAmount', { currencyID: invoice.currencyCode }).txt(invoice.taxAmount.toFixed(2));
  summation.ele('ram:GrandTotalAmount').txt(invoice.grossAmount.toFixed(2));
  summation.ele('ram:DuePayableAmount').txt(invoice.grossAmount.toFixed(2));

  return root.end({ prettyPrint: true });
}

// ── InvoiceData + CII XML → Factur-X PDF/A-3 ──────────────────────────────────

const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4 in points
const MARGIN = 50;

async function buildFacturXPdf(invoice: InvoiceData, ciiXml: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  pdfDoc.setTitle(`Invoice ${invoice.id}`);
  pdfDoc.setAuthor(invoice.seller.name);
  pdfDoc.setSubject(`Factur-X invoice ${invoice.id} for ${invoice.buyer.name}`);
  pdfDoc.setKeywords(['Factur-X', 'EN16931', 'Invoice', invoice.id]);
  pdfDoc.setProducer('SpreadsheetApp Factur-X Generator');
  pdfDoc.setCreator('SpreadsheetApp');
  pdfDoc.setCreationDate(new Date());
  pdfDoc.setModificationDate(new Date());

  drawInvoice(pdfDoc, invoice, font, boldFont);

  await pdfDoc.attach(Buffer.from(ciiXml, 'utf-8'), FACTURX_ATTACHMENT_NAME, {
    mimeType: 'application/xml',
    description: 'Factur-X CII invoice XML (EN 16931 profile)',
    creationDate: new Date(),
    modificationDate: new Date(),
    afRelationship: AFRelationship.Data,
  });

  attachXmpMetadata(pdfDoc, invoice);
  attachOutputIntent(pdfDoc);

  return pdfDoc.save();
}

function drawInvoice(pdfDoc: PDFDocument, invoice: InvoiceData, font: PDFFont, boldFont: PDFFont): void {
  let page = pdfDoc.addPage(PAGE_SIZE);
  let y = PAGE_SIZE[1] - MARGIN;
  const [pageWidth] = PAGE_SIZE;

  const dark = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.4, 0.45, 0.52);
  const accent = rgb(0.39, 0.4, 0.95);

  const write = (text: string, x: number, size: number, useFont: PDFFont, color = dark): void => {
    page.drawText(text, { x, y, size, font: useFont, color });
  };

  write('INVOICE', MARGIN, 22, boldFont, accent);
  write(`Factur-X / PDF-A-3 · EN 16931`, MARGIN, 9, font, gray);
  y -= 14;
  write(`Invoice ${invoice.id}`, MARGIN, 11, boldFont);
  y -= 40;

  const colWidth = (pageWidth - MARGIN * 2 - 20) / 2;
  const sellerX = MARGIN;
  const buyerX = MARGIN + colWidth + 20;
  const topY = y;

  const drawParty = (label: string, x: number, party: InvoiceParty): void => {
    let py = topY;
    page.drawText(label, { x, y: py, size: 8, font: boldFont, color: gray });
    py -= 14;
    page.drawText(party.name, { x, y: py, size: 10, font: boldFont, color: dark });
    py -= 13;
    page.drawText(party.streetName, { x, y: py, size: 9, font, color: dark });
    py -= 12;
    page.drawText(`${party.postalZone} ${party.cityName}, ${party.countryCode}`, { x, y: py, size: 9, font, color: dark });
    if (party.vatNumber) {
      py -= 12;
      page.drawText(`VAT: ${party.vatNumber}`, { x, y: py, size: 9, font, color: dark });
    }
  };

  drawParty('SELLER', sellerX, invoice.seller);
  drawParty('BILL TO', buyerX, invoice.buyer);

  y = topY - 80;
  page.drawText(`Issue date: ${invoice.issueDate}`, { x: MARGIN, y, size: 9, font, color: gray });
  page.drawText(`Currency: ${invoice.currencyCode}`, { x: MARGIN + 180, y, size: 9, font, color: gray });
  if (invoice.dueDate) {
    page.drawText(`Due date: ${invoice.dueDate}`, { x: MARGIN + 340, y, size: 9, font, color: gray });
  }
  y -= 25;

  // ── Line item table ──────────────────────────────────────────────────────
  const columns = [
    { key: 'description', label: 'Description', x: MARGIN, width: 220 },
    { key: 'quantity', label: 'Qty', x: MARGIN + 220, width: 50 },
    { key: 'unitPrice', label: 'Unit Price', x: MARGIN + 270, width: 70 },
    { key: 'vatRate', label: 'VAT %', x: MARGIN + 340, width: 50 },
    { key: 'netAmount', label: 'Net', x: MARGIN + 390, width: 70 },
  ] as const;

  const drawTableHeader = (): void => {
    page.drawRectangle({ x: MARGIN, y: y - 4, width: pageWidth - MARGIN * 2, height: 18, color: rgb(0.97, 0.97, 0.99) });
    for (const col of columns) {
      page.drawText(col.label, { x: col.x + 2, y: y, size: 8, font: boldFont, color: gray });
    }
    y -= 22;
  };

  drawTableHeader();

  for (const line of invoice.lines) {
    if (y < MARGIN + 120) {
      page = pdfDoc.addPage(PAGE_SIZE);
      y = PAGE_SIZE[1] - MARGIN;
      drawTableHeader();
    }
    const desc = line.description.length > 42 ? `${line.description.slice(0, 39)}...` : line.description;
    page.drawText(desc, { x: MARGIN + 2, y, size: 9, font, color: dark });
    page.drawText(line.quantity.toString(), { x: MARGIN + 222, y, size: 9, font, color: dark });
    page.drawText(line.unitPrice.toFixed(2), { x: MARGIN + 272, y, size: 9, font, color: dark });
    page.drawText(line.vatRate.toString(), { x: MARGIN + 342, y, size: 9, font, color: dark });
    page.drawText(line.netAmount.toFixed(2), { x: MARGIN + 392, y, size: 9, font, color: dark });
    y -= 16;
  }

  if (y < MARGIN + 90) {
    page = pdfDoc.addPage(PAGE_SIZE);
    y = PAGE_SIZE[1] - MARGIN;
  }

  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: pageWidth - MARGIN, y }, thickness: 0.75, color: rgb(0.85, 0.87, 0.9) });
  y -= 20;

  const totalsX = pageWidth - MARGIN - 160;
  const drawTotal = (label: string, value: string, bold = false): void => {
    page.drawText(label, { x: totalsX, y, size: 9, font: bold ? boldFont : font, color: bold ? dark : gray });
    page.drawText(value, { x: totalsX + 90, y, size: 9, font: bold ? boldFont : font, color: dark });
    y -= 15;
  };

  drawTotal('Net amount', `${invoice.netAmount.toFixed(2)} ${invoice.currencyCode}`);
  drawTotal('VAT amount', `${invoice.taxAmount.toFixed(2)} ${invoice.currencyCode}`);
  drawTotal('Total payable', `${invoice.grossAmount.toFixed(2)} ${invoice.currencyCode}`, true);

  y -= 25;
  page.drawText(
    'This PDF embeds a machine-readable Factur-X (CII/EN16931) XML invoice as an attachment.',
    { x: MARGIN, y, size: 7.5, font, color: gray },
  );
}

// ── XMP metadata (Factur-X detection + PDF/A-3 identification) ────────────────

function attachXmpMetadata(pdfDoc: PDFDocument, invoice: InvoiceData): void {
  const now = new Date().toISOString();
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
      xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Invoice ${escapeXml(invoice.id)}</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">Factur-X invoice ${escapeXml(invoice.id)}</rdf:li></rdf:Alt></dc:description>
      <pdf:Producer>SpreadsheetApp Factur-X Generator</pdf:Producer>
      <xmp:CreatorTool>SpreadsheetApp</xmp:CreatorTool>
      <xmp:CreateDate>${now}</xmp:CreateDate>
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${FACTURX_ATTACHMENT_NAME}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const stream = pdfDoc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  const ref = pdfDoc.context.register(stream);
  pdfDoc.catalog.set(PDFName.of('Metadata'), ref);
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

/**
 * PDF/A-3 requires an OutputIntent with an embedded ICC profile. There's no way to
 * fabricate a valid ICC profile from code — this reads a real sRGB profile from disk
 * if one has been provided, and otherwise skips the OutputIntent (the PDF is still
 * valid, just without full PDF/A-3 colour-space certification).
 *
 * To enable it: download a standard sRGB ICC profile (e.g. "sRGB2014.icc" from
 * https://www.color.org/srgbprofiles.xalter) and save it as backend/assets/sRGB.icc.
 */
function attachOutputIntent(pdfDoc: PDFDocument): void {
  if (!fs.existsSync(ICC_PROFILE_PATH)) {
    logger.warn(
      `No ICC profile found at ${ICC_PROFILE_PATH} — generated PDF will omit the PDF/A-3 OutputIntent. ` +
        'See FacturxService.attachOutputIntent() for how to enable full PDF/A-3 colour certification.',
    );
    return;
  }

  const iccBytes = fs.readFileSync(ICC_PROFILE_PATH);
  const iccStream = pdfDoc.context.flateStream(iccBytes, { N: 3 });
  const iccRef = pdfDoc.context.register(iccStream);

  const outputIntent = pdfDoc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: 'sRGB IEC61966-2.1',
    Info: 'sRGB IEC61966-2.1',
    RegistryName: 'http://www.color.org',
    DestOutputProfile: iccRef,
  });
  const outputIntentRef = pdfDoc.context.register(outputIntent);
  pdfDoc.catalog.set(PDFName.of('OutputIntents'), pdfDoc.context.obj([outputIntentRef]));
}
