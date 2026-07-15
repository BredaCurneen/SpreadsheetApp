import { create } from 'xmlbuilder2';
import { InvoiceData, InvoiceLineItem, InvoiceParty } from '../types/invoice.types';

const NS = {
  ubl: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
};

const PEPPOL_CUSTOMIZATION =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
const PEPPOL_PROFILE = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

// ── PEPPOL EAS scheme codes by ISO 3166-1 alpha-2 country code ────────────────
// Used to derive EndpointID scheme when no explicit endpointSchemeId is configured.
// Source: PEPPOL Electronic Address Scheme (EAS) code list.
const EAS_BY_COUNTRY: Record<string, string> = {
  AT: '9915', BE: '9925', BG: '9926', CH: '9927', CY: '9928',
  CZ: '9929', DE: '9930', DK: '9902', EE: '9931', ES: '9920',
  FI: '9932', FR: '9957', GR: '9934', HR: '9935', HU: '9936',
  IE: '9937', IT: '9906', LT: '9938', LU: '9939', LV: '9940',
  MT: '9942', NL: '9944', NO: '0192', PL: '9945', PT: '9946',
  RO: '9947', SE: '0007', SI: '9948', SK: '9949',
};

// ── Tax exemption metadata keyed by UNTDID-5305 category code ─────────────────
// BR-Z-10: Z (Zero rated) MUST NOT carry TaxExemptionReason/Code — no entry for Z.
// P0105: VATEX-EU-O is valid ONLY for category O (Outside scope), never for Z.
const TAX_EXEMPTION: Record<string, { code: string; reason: string }> = {
  AE: { code: 'VATEX-EU-AE',   reason: 'Reverse charge' },
  K:  { code: 'VATEX-EU-IC',   reason: 'Intra-community supply' },
  E:  { code: 'VATEX-EU-79-C', reason: 'Exempt based on article 132 of Council Directive 2006/112/EC' },
  O:  { code: 'VATEX-EU-O',    reason: 'Not subject to VAT' },
};

export class UblService {
  generate(invoice: InvoiceData): string {
    // Pre-compute the effective tax categories across all lines — needed to
    // conditionally emit Delivery and InvoicePeriod for K-category rules.
    const effectiveCategories = new Set(
      invoice.lines.map(l => l.taxCategory ?? (l.vatRate > 0 ? 'S' : 'Z')),
    );
    const hasK = effectiveCategories.has('K');

    const inv = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
      xmlns: NS.ubl,
      'xmlns:cac': NS.cac,
      'xmlns:cbc': NS.cbc,
    });

    // ── Header ─────────────────────────────────────────────────────────────
    inv.ele('cbc:CustomizationID').txt(PEPPOL_CUSTOMIZATION);
    inv.ele('cbc:ProfileID').txt(PEPPOL_PROFILE);
    inv.ele('cbc:ID').txt(invoice.id);
    inv.ele('cbc:IssueDate').txt(invoice.issueDate);
    if (invoice.dueDate) inv.ele('cbc:DueDate').txt(invoice.dueDate);
    inv.ele('cbc:InvoiceTypeCode').txt(invoice.typeCode);
    if (invoice.note) inv.ele('cbc:Note').txt(invoice.note);
    inv.ele('cbc:DocumentCurrencyCode').txt(invoice.currencyCode);
    // TaxCurrencyCode is intentionally omitted:
    //   PEPPOL-EN16931-R005 requires it to differ from DocumentCurrencyCode.
    //   PEPPOL-EN16931-R054 then requires exactly one TaxTotal without TaxSubtotals.
    //   Both rules are avoided by omitting TaxCurrencyCode when VAT accounting
    //   uses the same currency as the invoice.
    if (invoice.buyerReference) inv.ele('cbc:BuyerReference').txt(invoice.buyerReference);

    // ── InvoicePeriod (BG-14) ──────────────────────────────────────────────
    // Satisfies BR-IC-11 (K category requires ActualDeliveryDate or InvoicePeriod).
    // Also emitted for non-K invoices when the service period is known.
    if (invoice.invoicePeriodStart || invoice.invoicePeriodEnd) {
      const period = inv.ele('cac:InvoicePeriod');
      if (invoice.invoicePeriodStart) period.ele('cbc:StartDate').txt(invoice.invoicePeriodStart);
      if (invoice.invoicePeriodEnd) period.ele('cbc:EndDate').txt(invoice.invoicePeriodEnd);
    }

    // ── BillingReference — DE-R-026 ────────────────────────────────────────
    // Required when InvoiceTypeCode = 384 (corrected invoice / credit note).
    if (invoice.typeCode === '384' && invoice.precedingInvoiceId) {
      const billingRef = inv.ele('cac:BillingReference');
      const docRef = billingRef.ele('cac:InvoiceDocumentReference');
      docRef.ele('cbc:ID').txt(invoice.precedingInvoiceId);
      if (invoice.precedingInvoiceDate) {
        docRef.ele('cbc:IssueDate').txt(invoice.precedingInvoiceDate);
      }
    }

    // ── Seller ─────────────────────────────────────────────────────────────
    const sellerEl = inv.ele('cac:AccountingSupplierParty').ele('cac:Party');
    // EndpointID (BT-34) — PEPPOL-EN16931-R020: required.
    // schemeID 0088 (GLN) would violate PEPPOL-COMMON-R040 with a VAT number;
    // we resolve the correct EAS scheme from the country code instead.
    const sellerEndpoint = resolveEndpoint(invoice.seller);
    if (sellerEndpoint) {
      sellerEl.ele('cbc:EndpointID', { schemeID: sellerEndpoint.schemeId }).txt(sellerEndpoint.id);
    }
    sellerEl.ele('cac:PartyName').ele('cbc:Name').txt(invoice.seller.name);
    const sellerAddr = sellerEl.ele('cac:PostalAddress');
    sellerAddr.ele('cbc:StreetName').txt(invoice.seller.streetName);
    sellerAddr.ele('cbc:CityName').txt(invoice.seller.cityName);
    sellerAddr.ele('cbc:PostalZone').txt(invoice.seller.postalZone);
    sellerAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt(invoice.seller.countryCode);
    if (invoice.seller.vatNumber) {
      const sellerTax = sellerEl.ele('cac:PartyTaxScheme');
      sellerTax.ele('cbc:CompanyID').txt(invoice.seller.vatNumber);
      sellerTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }
    const sellerLegal = sellerEl.ele('cac:PartyLegalEntity');
    sellerLegal.ele('cbc:RegistrationName').txt(
      invoice.seller.registrationName ?? invoice.seller.name,
    );
    if (invoice.seller.vatNumber) {
      sellerLegal.ele('cbc:CompanyID').txt(invoice.seller.vatNumber);
    }
    // Seller Contact BG-6 — DE-R-002
    const hasContact =
      invoice.seller.contactName || invoice.seller.contactPhone || invoice.seller.contactEmail;
    if (hasContact) {
      const contact = sellerEl.ele('cac:Contact');
      if (invoice.seller.contactName) contact.ele('cbc:Name').txt(invoice.seller.contactName);
      if (invoice.seller.contactPhone) contact.ele('cbc:Telephone').txt(invoice.seller.contactPhone);
      if (invoice.seller.contactEmail) contact.ele('cbc:ElectronicMail').txt(invoice.seller.contactEmail);
    }

    // ── Buyer ──────────────────────────────────────────────────────────────
    const buyerEl = inv.ele('cac:AccountingCustomerParty').ele('cac:Party');
    // EndpointID (BT-49) — PEPPOL-EN16931-R010: required.
    const buyerEndpoint = resolveEndpoint(invoice.buyer);
    if (buyerEndpoint) {
      buyerEl.ele('cbc:EndpointID', { schemeID: buyerEndpoint.schemeId }).txt(buyerEndpoint.id);
    }
    buyerEl.ele('cac:PartyName').ele('cbc:Name').txt(invoice.buyer.name);
    const buyerAddr = buyerEl.ele('cac:PostalAddress');
    buyerAddr.ele('cbc:StreetName').txt(invoice.buyer.streetName);
    buyerAddr.ele('cbc:CityName').txt(invoice.buyer.cityName);
    buyerAddr.ele('cbc:PostalZone').txt(invoice.buyer.postalZone);
    buyerAddr.ele('cac:Country').ele('cbc:IdentificationCode').txt(invoice.buyer.countryCode);
    if (invoice.buyer.vatNumber) {
      const buyerTax = buyerEl.ele('cac:PartyTaxScheme');
      buyerTax.ele('cbc:CompanyID').txt(invoice.buyer.vatNumber);
      buyerTax.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }
    const buyerLegal = buyerEl.ele('cac:PartyLegalEntity');
    buyerLegal.ele('cbc:RegistrationName').txt(
      invoice.buyer.registrationName ?? invoice.buyer.name,
    );

    // ── Delivery ───────────────────────────────────────────────────────────
    // Required when K (intra-community supply) lines are present:
    //   BR-IC-11: ActualDeliveryDate (or InvoicePeriod above) must be provided.
    //   BR-IC-12: DeliverToCountryCode (BT-80) must be provided.
    // DE-R-010/011: when DeliveryLocation (BG-15) is emitted, CityName (BT-77)
    //   and PostalZone (BT-78) are also required. Default to buyer address fields
    //   when no explicit delivery address is mapped.
    const needsDelivery = hasK || !!invoice.delivery?.actualDeliveryDate;
    if (needsDelivery) {
      const deliveryCountry = invoice.delivery?.countryCode || invoice.buyer.countryCode;
      const deliveryCity    = invoice.delivery?.city        || invoice.buyer.cityName;
      const deliveryPostal  = invoice.delivery?.postalCode  || invoice.buyer.postalZone;
      const del = inv.ele('cac:Delivery');
      if (invoice.delivery?.actualDeliveryDate) {
        del.ele('cbc:ActualDeliveryDate').txt(invoice.delivery.actualDeliveryDate);
      }
      if (hasK || deliveryCountry) {
        const addr = del.ele('cac:DeliveryLocation').ele('cac:Address');
        if (deliveryCity)   addr.ele('cbc:CityName').txt(deliveryCity);
        if (deliveryPostal) addr.ele('cbc:PostalZone').txt(deliveryPostal);
        addr.ele('cac:Country').ele('cbc:IdentificationCode').txt(deliveryCountry);
      }
    }

    // ── Payment ────────────────────────────────────────────────────────────
    if (invoice.payment.iban || invoice.payment.bic) {
      const pm = inv.ele('cac:PaymentMeans');
      pm.ele('cbc:PaymentMeansCode').txt('30'); // 30 = credit transfer
      if (invoice.payment.iban) {
        const account = pm.ele('cac:PayeeFinancialAccount');
        account.ele('cbc:ID').txt(invoice.payment.iban);
        if (invoice.payment.bic) {
          account.ele('cac:FinancialInstitutionBranch').ele('cbc:ID').txt(invoice.payment.bic);
        }
      }
    }
    if (invoice.payment.paymentTerms) {
      inv.ele('cac:PaymentTerms').ele('cbc:Note').txt(invoice.payment.paymentTerms);
    }

    // ── TaxTotal ───────────────────────────────────────────────────────────
    // One TaxTotal at invoice level, grouped by (tax category code × tax rate).
    // TaxExemptionReasonCode/Reason added for AE, K, E, O (TAX_EXEMPTION table).
    // Z (Zero rated) intentionally has NO exemption fields — BR-Z-10 prohibits them.
    const taxTotal = inv.ele('cac:TaxTotal');
    taxTotal
      .ele('cbc:TaxAmount', { currencyID: invoice.currencyCode })
      .txt(invoice.taxAmount.toFixed(2));

    for (const group of groupByTax(invoice.lines).values()) {
      const groupNet = round2(group.lines.reduce((s, l) => s + l.netAmount, 0));
      const groupVat = round2(group.lines.reduce((s, l) => s + l.vatAmount, 0));
      const sub = taxTotal.ele('cac:TaxSubtotal');
      sub
        .ele('cbc:TaxableAmount', { currencyID: invoice.currencyCode })
        .txt(groupNet.toFixed(2));
      sub
        .ele('cbc:TaxAmount', { currencyID: invoice.currencyCode })
        .txt(groupVat.toFixed(2));
      const cat = sub.ele('cac:TaxCategory');
      cat.ele('cbc:ID').txt(group.category);
      cat.ele('cbc:Percent').txt(group.rate.toString());
      // BR-AE-10: AE requires TaxExemptionReasonCode "VATEX-EU-AE" and/or reason "Reverse charge"
      // BR-IC-10: K requires TaxExemptionReasonCode "VATEX-EU-IC" and/or reason "Intra-community supply"
      const exemption = TAX_EXEMPTION[group.category];
      if (exemption) {
        cat.ele('cbc:TaxExemptionReasonCode').txt(exemption.code);
        cat.ele('cbc:TaxExemptionReason').txt(exemption.reason);
      }
      cat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');
    }

    // ── LegalMonetaryTotal ─────────────────────────────────────────────────
    const totals = inv.ele('cac:LegalMonetaryTotal');
    totals.ele('cbc:LineExtensionAmount', { currencyID: invoice.currencyCode }).txt(invoice.netAmount.toFixed(2));
    totals.ele('cbc:TaxExclusiveAmount', { currencyID: invoice.currencyCode }).txt(invoice.netAmount.toFixed(2));
    totals.ele('cbc:TaxInclusiveAmount', { currencyID: invoice.currencyCode }).txt(invoice.grossAmount.toFixed(2));
    totals.ele('cbc:PayableAmount', { currencyID: invoice.currencyCode }).txt(invoice.grossAmount.toFixed(2));

    // ── Invoice Lines ──────────────────────────────────────────────────────
    // TaxTotal is intentionally absent from InvoiceLine — UBL-CR-561.
    // Per-line tax is declared via cac:ClassifiedTaxCategory inside cac:Item.
    for (const line of invoice.lines) {
      const lineEl = inv.ele('cac:InvoiceLine');
      lineEl.ele('cbc:ID').txt(line.lineNumber.toString());
      lineEl
        .ele('cbc:InvoicedQuantity', { unitCode: line.unit })
        .txt(line.quantity.toString());
      lineEl
        .ele('cbc:LineExtensionAmount', { currencyID: invoice.currencyCode })
        .txt(line.netAmount.toFixed(2));

      const item = lineEl.ele('cac:Item');
      item.ele('cbc:Description').txt(line.description);
      item.ele('cbc:Name').txt(line.description);
      const effectiveCategory = line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z');
      const itemCat = item.ele('cac:ClassifiedTaxCategory');
      itemCat.ele('cbc:ID').txt(effectiveCategory);
      itemCat.ele('cbc:Percent').txt(line.vatRate.toString());
      itemCat.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT');

      const price = lineEl.ele('cac:Price');
      price
        .ele('cbc:PriceAmount', { currencyID: invoice.currencyCode })
        .txt(line.unitPrice.toFixed(2));
    }

    return inv.end({ prettyPrint: true });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TaxGroup {
  category: string;
  rate: number;
  lines: InvoiceLineItem[];
}

/**
 * Groups lines by (UNTDID-5305 category code, VAT rate).
 * A rate-only key would merge AE/K/Z 0% lines into a single bucket and produce
 * wrong category codes in TaxSubtotal elements.
 */
function groupByTax(lines: InvoiceLineItem[]): Map<string, TaxGroup> {
  const map = new Map<string, TaxGroup>();
  for (const line of lines) {
    const category = line.taxCategory ?? (line.vatRate > 0 ? 'S' : 'Z');
    const key = `${category}:${line.vatRate}`;
    if (!map.has(key)) {
      map.set(key, { category, rate: line.vatRate, lines: [] });
    }
    map.get(key)!.lines.push(line);
  }
  return map;
}

/**
 * Resolves the PEPPOL EndpointID for a party.
 * Priority: explicit endpointId + endpointSchemeId from the mapping.
 * Fallback: VAT number with the EAS scheme derived from the party's country code.
 * Returns null if neither source provides a usable value.
 */
function resolveEndpoint(party: InvoiceParty): { id: string; schemeId: string } | null {
  if (party.endpointId && party.endpointSchemeId) {
    return { id: party.endpointId, schemeId: party.endpointSchemeId };
  }
  if (party.vatNumber) {
    const scheme = party.endpointSchemeId ?? EAS_BY_COUNTRY[party.countryCode.toUpperCase()];
    if (scheme) return { id: party.vatNumber, schemeId: scheme };
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
