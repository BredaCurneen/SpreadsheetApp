/** EN16931 / PEPPOL allowed tax category identifiers (UNTDID 5305). */
export type TaxCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'O';

export interface InvoiceLineItem {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number;
  taxCategory?: TaxCategory; // explicit override; derived from vatRate when absent
  netAmount: number;
  vatAmount: number;
}

export interface InvoiceParty {
  name: string;
  streetName: string;
  cityName: string;
  postalZone: string;
  countryCode: string;
  vatNumber?: string;
  registrationName?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  endpointId?: string;      // explicit PEPPOL/EAS endpoint identifier (overrides VAT fallback)
  endpointSchemeId?: string; // EAS scheme code, e.g. '9930' for DE:VAT
}

export interface PaymentMeans {
  iban?: string;
  bic?: string;
  paymentTerms?: string;
}

export interface InvoiceData {
  id: string;
  issueDate: string;
  dueDate?: string;
  typeCode: string;
  currencyCode: string;
  buyerReference?: string;
  note?: string;
  precedingInvoiceId?: string;   // required by DE-R-026 when typeCode = '384'
  precedingInvoiceDate?: string;
  invoicePeriodStart?: string;   // BG-14: satisfies BR-IC-11 for K-category invoices
  invoicePeriodEnd?: string;
  delivery?: {
    actualDeliveryDate?: string; // BT-72: satisfies BR-IC-11 for K-category invoices
    countryCode?: string;        // BT-80: satisfies BR-IC-12; defaults to buyer country
    city?: string;               // BT-77: DE-R-010 requires this when DeliveryLocation present; defaults to buyer city
    postalCode?: string;         // BT-78: DE-R-011 requires this when DeliveryLocation present; defaults to buyer postalZone
  };
  seller: InvoiceParty;
  buyer: InvoiceParty;
  payment: PaymentMeans;
  lines: InvoiceLineItem[];
  taxAmount: number;
  netAmount: number;
  grossAmount: number;
}

export interface ConversionResult {
  success: boolean;
  xml?: string;
  errors?: ValidationError[];
  message?: string;
}

export interface ValidationError {
  code: string;
  severity: 'fatal' | 'warning';
  message: string;
  location?: string;
}

// ── Mapping config types ──────────────────────────────────────────────────────

export interface CellRef {
  col: number; // 0-based column index
  row: number; // 0-based row index
}

export interface PartyMapping {
  name: CellRef;
  street: CellRef;
  city: CellRef;
  postalCode: CellRef;
  country: CellRef;
  vatNumber?: CellRef;
  registration?: CellRef;
  contactName?: CellRef;
  contactPhone?: CellRef;
  contactEmail?: CellRef;
  endpointId?: CellRef;      // explicit endpoint value; falls back to vatNumber in UBL generator
  endpointSchemeId?: string; // EAS scheme literal, e.g. '9930'; auto-derived from country when absent
}

export interface PaymentMapping {
  iban?: CellRef;
  bic?: CellRef;
  paymentTerms?: CellRef;
}

export interface LineItemColumns {
  description: number;
  quantity: number;
  unit: number;
  unitPrice: number;
  vatRate: number;
  netAmount?: number;
  taxCategory?: number; // column index for the UNTDID 5305 code (S, AE, Z, K, …)
}

export interface MappingConfig {
  sheet: string;
  fields: {
    invoiceId: CellRef;
    issueDate: CellRef;
    dueDate?: CellRef;
    typeCode?: CellRef;
    currencyCode: CellRef;
    buyerReference?: CellRef;
    note?: CellRef;
    precedingInvoiceId?: CellRef;
    precedingInvoiceDate?: CellRef;
    invoicePeriodStart?: CellRef;
    invoicePeriodEnd?: CellRef;
    delivery?: {
      actualDeliveryDate?: CellRef;
      countryCode?: CellRef;
      city?: CellRef;       // BT-77; when absent, buyer city is used as default
      postalCode?: CellRef; // BT-78; when absent, buyer postalZone is used as default
    };
    seller: PartyMapping;
    buyer: PartyMapping;
    payment: PaymentMapping;
    lineItemsStartRow: number;
    lineItemColumns: LineItemColumns;
  };
}
