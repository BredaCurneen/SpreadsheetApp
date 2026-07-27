# SpreadsheetApp — Internal Invoice JSON Model

Source of truth: `backend/src/types/invoice.types.ts`. This is the **single**
internal shape every generator (UBL, and — via UBL-reversal — CII, XRechnung,
ZUGFeRD) is built from or reconstructed into. It is intentionally flatter and
simpler than any of the standards' own JSON/XML shapes; each generator is
responsible for its own mapping to/from this model.

## 1. `InvoiceData` — top level

```ts
interface InvoiceData {
  id: string;                        // required — BT-1 Invoice number
  issueDate: string;                 // required — BT-2, ISO 8601 (YYYY-MM-DD)
  dueDate?: string;                  // optional — BT-9
  typeCode: string;                  // required — BT-3 (UNTDID 1001), defaults to "380"
  currencyCode: string;              // required — BT-5, ISO 4217
  buyerReference?: string;           // optional — BT-10
  note?: string;                     // optional — BT-22
  precedingInvoiceId?: string;       // optional — BT-25, required by BR when typeCode = "384"
  precedingInvoiceDate?: string;     // optional — BT-26
  invoicePeriodStart?: string;       // optional — BT-73
  invoicePeriodEnd?: string;         // optional — BT-74
  delivery?: {
    actualDeliveryDate?: string;     // optional — BT-72
    countryCode?: string;            // optional — BT-80, required (auto-filled) when any K line exists
    city?: string;                   // optional — BT-77
    postalCode?: string;             // optional — BT-78
  };
  seller: InvoiceParty;              // required
  buyer: InvoiceParty;                // required
  payment: PaymentMeans;              // required (object always present; fields inside are optional)
  lines: InvoiceLineItem[];           // required, non-empty
  taxAmount: number;                   // required — BT-110, sum of line VAT amounts
  netAmount: number;                   // required — BT-109, sum of line net amounts
  grossAmount: number;                 // required — BT-112, netAmount + taxAmount
}
```

## 2. `InvoiceParty` — Buyer / Seller structure

```ts
interface InvoiceParty {
  name: string;              // required — BT-27 (seller) / BT-44 (buyer)
  streetName: string;        // required — BT-35 / BT-50
  cityName: string;          // required — BT-37 / BT-52
  postalZone: string;        // required — BT-38 / BT-53
  countryCode: string;       // required — BT-40 / BT-55, ISO 3166-1 alpha-2
  vatNumber?: string;        // optional but effectively required for S/Z/AE lines (BT-31 / BT-48)
  registrationName?: string; // optional — BT-27/BT-44 legal name, defaults to `name`
  contactName?: string;      // optional — BT-41 / BT-56
  contactPhone?: string;     // optional — BT-42 / BT-57
  contactEmail?: string;     // optional — BT-43 / BT-58
  endpointId?: string;       // optional — BT-34 / BT-49, explicit PEPPOL/EAS endpoint value
  endpointSchemeId?: string; // optional — EAS scheme code, e.g. "9930" for DE:VAT
}
```

`vatNumber` is technically optional in the type, but:
- Its absence generates `BR-14` (warning) at the UBL-validation stage.
- Its absence causes CII/XRechnung/ZUGFeRD generation to fall back to a
  literal `"NA"` placeholder (with a logged warning) to satisfy
  `BR-S-02`/`BR-Z-02`/`BR-AE-02` — see [`errors.md`](./errors.md).

## 3. `InvoiceLineItem` — line item structure

```ts
type TaxCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'O';

interface InvoiceLineItem {
  lineNumber: number;          // required — 1-based, assigned during extraction
  description: string;         // required — BT-153
  quantity: number;            // required — BT-129, must be non-zero
  unit: string;                // required — BT-130, UN/ECE Recommendation 20 code (e.g. "C62", "HUR", "DAY")
  unitPrice: number;           // required — BT-146, must be > 0
  vatRate: number;              // required — BT-152, percentage (e.g. 23 for 23%)
  taxCategory?: TaxCategory;   // optional — BT-151; derived as S/Z from vatRate if absent
  netAmount: number;            // required — BT-131, line net amount
  vatAmount: number;             // required — derived as netAmount × (vatRate / 100)
}
```

## 4. `PaymentMeans` structure

```ts
interface PaymentMeans {
  iban?: string;          // optional — BT-84
  bic?: string;           // optional — BT-86
  paymentTerms?: string;  // optional — BT-20
}
```

## 5. VAT breakdown structure (derived, not stored)

`InvoiceData` does **not** store a pre-computed VAT breakdown (BG-23) — every
generator derives it on the fly by grouping `lines` by
`(taxCategory, vatRate)`:

```ts
interface TaxGroup {
  category: string;   // S | Z | E | AE | K | O
  rate: number;       // the VAT percentage shared by every line in the group
  netAmount: number;  // sum of netAmount across lines in the group
  vatAmount: number;  // sum of vatAmount across lines in the group
}
```

This grouping function (`groupByTax()`) is implemented independently in
`ubl.service.ts`, `facturx.service.ts`, `xrechnung.service.ts`,
`zugferd.service.ts`, and `cii.service.ts` — each generator produces its own
`cac:TaxTotal/cac:TaxSubtotal` (UBL) or
`ApplicableHeaderTradeSettlement/ApplicableTradeTax` (CII) entries from it,
one per distinct `(category, rate)` pair.

## 6. Supporting types (`ValidationError`, `ConversionResult`)

```ts
interface ValidationError {
  code: string;
  severity: 'fatal' | 'warning';
  message: string;
  location?: string;
}

interface ConversionResult {
  success: boolean;
  xml?: string;
  errors?: ValidationError[];
  message?: string;
}
```

## 7. Full example `InvoiceData` JSON

```json
{
  "id": "INV-2026-001",
  "issueDate": "2026-07-10",
  "dueDate": "2026-08-09",
  "typeCode": "380",
  "currencyCode": "EUR",
  "buyerReference": "PO-4471",
  "note": "Thank you for your business.",
  "seller": {
    "name": "Omni Consulting Ltd",
    "streetName": "12 Harbour Road",
    "cityName": "Dublin",
    "postalZone": "D02 XY45",
    "countryCode": "IE",
    "vatNumber": "IE1234567T",
    "registrationName": "Omni Consulting Ltd",
    "contactName": "Sarah Byrne",
    "contactEmail": "sarah@omni.ie",
    "contactPhone": "+353 1 234 5678"
  },
  "buyer": {
    "name": "Acme Retail GmbH",
    "streetName": "Hauptstrasse 5",
    "cityName": "Berlin",
    "postalZone": "10115",
    "countryCode": "DE",
    "vatNumber": "DE987654321",
    "registrationName": "Acme Retail GmbH"
  },
  "payment": {
    "iban": "IE29AIBK93115212345678",
    "bic": "AIBKIE2D",
    "paymentTerms": "Net 30 days"
  },
  "lines": [
    {
      "lineNumber": 1,
      "description": "Consulting services — Q3 roadmap",
      "quantity": 10,
      "unit": "HUR",
      "unitPrice": 150,
      "vatRate": 23,
      "taxCategory": "S",
      "netAmount": 1500,
      "vatAmount": 345
    },
    {
      "lineNumber": 2,
      "description": "On-site workshop delivery",
      "quantity": 2,
      "unit": "DAY",
      "unitPrice": 800,
      "vatRate": 23,
      "taxCategory": "S",
      "netAmount": 1600,
      "vatAmount": 368
    }
  ],
  "taxAmount": 713,
  "netAmount": 3100,
  "grossAmount": 3813
}
```

This example (a real fixture used during development, see `examples.md`)
produces two lines in the same `(S, 23%)` tax group, so its generated
`cac:TaxTotal` has exactly one `cac:TaxSubtotal` entry.

## 8. Required vs. optional — quick reference table

| Field | Required? | Notes |
|---|---|---|
| `id`, `issueDate`, `typeCode`, `currencyCode` | ✅ required | Fatal `BR-*` error if missing |
| `dueDate`, `note`, `buyerReference` | Optional | |
| `precedingInvoiceId` / `Date` | Conditionally required | Only when `typeCode === '384'` |
| `invoicePeriodStart` / `End` | Optional | Emitted as BG-14; also satisfies BR-IC-11 for `K` lines |
| `delivery` (whole object) | Optional | Auto-populated with a country for `K`-category invoices even if not mapped |
| `seller`, `buyer` (whole object) | ✅ required | |
| `seller.name/streetName/cityName/postalZone/countryCode` | ✅ required | |
| `seller.vatNumber` | Optional, strongly recommended | Warning if absent; `"NA"` placeholder used downstream if absent |
| `payment` (object) | ✅ required | All fields inside are optional |
| `lines` | ✅ required, non-empty | |
| each line's `description/quantity/unitPrice` | ✅ required | |
| each line's `taxCategory` | Optional | Derived from `vatRate` if absent |
| `taxAmount`, `netAmount`, `grossAmount` | ✅ required | Must reconcile with line sums (`BR-CO-10`/`BR-CO-15`) |
