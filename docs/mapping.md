# SpreadsheetApp — Spreadsheet → JSON Mapping

This document explains how `backend/mappings/default-invoice-mapping.json`
maps spreadsheet cells to the internal `InvoiceData` model, as implemented in
`backend/src/services/mapping.service.ts`.

## 1. How mapping works

1. `SpreadsheetService.parse()` (SheetJS) turns the uploaded file into a 2-D
   cell matrix per sheet: `matrix[row][col]`.
2. `SpreadsheetService.resolveSheetName()` picks the sheet named in the
   mapping's `"sheet"` field (case-insensitive), falling back to the first
   sheet if no match.
3. `MappingService.apply()` walks the mapping config and pulls values out of
   the matrix by `{ col, row }` coordinates — **0-based**, matching
   JavaScript array indices, *not* spreadsheet A1-style references.

## 2. Column-letter ↔ index reference

| Column | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Index | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |

Row numbers work the same way: spreadsheet row `1` is index `0`.

## 3. `default-invoice-mapping.json` — full field reference

This mapping targets the same cell layout as `gflohr/e-invoice-eu`'s official
`default-corrected-invoice.ods` template.

| InvoiceData field | Spreadsheet cell | Col,Row (0-based) |
|---|---|---|
| `id` | O12 | 14, 11 |
| `issueDate` | I6 | 8, 5 |
| `dueDate` | I12 | 8, 11 |
| `currencyCode` | O11 | 14, 10 |
| `typeCode` | M19 | 12, 18 |
| `buyerReference` | I11 | 8, 10 |
| `precedingInvoiceId` | O13 | 14, 12 |
| `precedingInvoiceDate` | P13 | 15, 12 |
| `invoicePeriodStart` | I7 | 8, 6 |
| `invoicePeriodEnd` | I8 | 8, 7 |
| `delivery.actualDeliveryDate` | I8 | 8, 7 |
| `seller.name` / `seller.registrationName` | O1 | 14, 0 |
| `seller.streetName` | O2 | 14, 1 |
| `seller.postalZone` | O3 | 14, 2 |
| `seller.cityName` | O4 | 14, 3 |
| `seller.countryCode` | O5 | 14, 4 |
| `seller.vatNumber` | O6 | 14, 5 |
| `seller.contactName` | I14 | 8, 13 |
| `seller.contactEmail` | I15 | 8, 14 |
| `seller.contactPhone` | I16 | 8, 15 |
| `seller.endpointSchemeId` | *(literal, not a cell)* | `"9930"` (DE VAT EAS) |
| `buyer.name` | A7 | 0, 6 |
| `buyer.registrationName` | A1 | 0, 0 |
| `buyer.streetName` | O7 | 14, 6 |
| `buyer.postalZone` | O8 | 14, 7 |
| `buyer.cityName` | O9 | 14, 8 |
| `buyer.countryCode` | O10 | 14, 9 |
| `buyer.vatNumber` | I9 | 8, 8 |
| `buyer.endpointSchemeId` | *(literal, not a cell)* | `"9930"` |
| `payment.iban` | O15 | 14, 14 |
| `payment.bic` | O16 | 14, 15 |
| `payment.paymentTerms` | A47 | 0, 46 |

### Line items

| Field | Column | Index |
|---|---|---|
| `lineItemsStartRow` | — | row `22` (spreadsheet row 23) |
| `description` | B | 1 |
| `quantity` | D | 3 |
| `unit` | M | 12 |
| `unitPrice` | F | 5 |
| `vatRate` | O | 14 |
| `netAmount` | J | 9 |
| `taxCategory` | N | 13 |

Line extraction (`MappingService.extractLines()`) walks rows starting at
`lineItemsStartRow` and stops at the **first row with a blank description**
— so line items must be contiguous with no gaps.

If `netAmount` is left blank for a row, it's computed as `quantity × unitPrice`
rather than read from the sheet.

## 4. VAT category mapping (UNTDID 5305 / EN16931 BT-151)

| Code | Meaning | VAT rate required |
|---|---|---|
| `S` | Standard rate | > 0% |
| `Z` | Zero rated | 0% |
| `E` | Exempt from tax | 0% |
| `AE` | VAT Reverse Charge | 0% |
| `K` | Intra-community supply | 0% |
| `O` | Outside scope of VAT | 0% |

- If the `taxCategory` column is present and its value is one of the six
  codes above, that value is used as-is.
- If the column is blank, missing, or contains an unrecognised value, the
  category is **derived** at generation time (in `ubl.service.ts` and every
  downstream service) as: `vatRate > 0 ? 'S' : 'Z'`.
- `validator.service.ts` rejects (`BR-CAT`, fatal) any explicit value outside
  the six valid codes, and rejects (`BR-{cat}-1`, fatal) any zero-rate
  category (`Z`/`E`/`AE`/`K`/`O`) paired with a non-zero VAT rate.

## 5. Buyer / Seller field mapping

Both `PartyMapping` shapes support the same field set (see
`invoice.types.ts`):

```ts
interface PartyMapping {
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
  endpointId?: CellRef;       // explicit PEPPOL/EAS endpoint value
  endpointSchemeId?: string;  // EAS scheme code literal, e.g. "9930" for DE:VAT
}
```

- `name`, `street`, `city`, `postalCode`, `country` are **required** — the
  validator raises a fatal error if any are missing.
- `country` values are upper-cased automatically
  (`(cell(mapping.country) || '').toUpperCase()`).
- `registration` maps to `registrationName`, used for
  `PartyLegalEntity/RegistrationName` (UBL) or `SpecifiedLegalOrganization`
  (CII) — falls back to `name` if not mapped.
- `endpointId` / `endpointSchemeId` are optional; if omitted, `ubl.service.ts`
  derives the PEPPOL endpoint from the VAT number and a per-country EAS table
  (see `resolveEndpoint()` in `ubl.service.ts`).

## 6. Delivery fields and fallback logic

```ts
delivery?: {
  actualDeliveryDate?: string; // BT-72
  countryCode?: string;        // BT-80 ("Deliver To Country")
  city?: string;               // BT-77
  postalCode?: string;         // BT-78
}
```

The `delivery` object as a whole is only populated (non-`undefined`) if **at
least one** of its four sub-fields resolves to a non-empty value.

**Fallback chain when `delivery.countryCode` is not mapped, for `K`-category
(intra-community supply) invoices:**

| Stage | UBL (`ubl.service.ts`) | CII / XRechnung / ZUGFeRD / CII services |
|---|---|---|
| 1st | Explicit `delivery.countryCode` from spreadsheet | Explicit `delivery.countryCode` (from the UBL just parsed back) |
| 2nd | **Buyer's** country | **Seller's** country |
| 3rd | *(buyer country is always available, so this tier is unused)* | Literal `"IE"` |

Because the CII/XRechnung/ZUGFeRD/CII services derive their `InvoiceData` by
re-parsing the UBL XML (which already went through `ubl.service.ts`'s own
fallback), the "2nd" tier above rarely triggers for them in practice — the
delivery country is usually already resolved to the buyer's country by the
time they run. See [`errors.md §3`](./errors.md#br-ic-12-cii-path) for the
full explanation.

`delivery.city` / `delivery.postalCode` similarly default to the buyer's
`cityName` / `postalZone` in `ubl.service.ts` when a `K`-category delivery
location is emitted but no explicit delivery city/postcode was mapped.

## 7. Date normalisation

`MappingService.normaliseDate()` accepts:

1. Already-ISO `YYYY-MM-DD` strings — passed through unchanged.
2. `DD/MM/YYYY` or `DD-MM-YYYY` (or `MM/DD/YYYY` — the regex doesn't
   disambiguate day/month order, it assumes `first-group/second-group/year`)
   — reformatted to `YYYY-MM-DD`.
3. Anything else `new Date(raw)` can parse (including native Excel/ODS date
   cells, which SheetJS already converts to JS `Date` objects via
   `cellDates: true` before this function ever sees a string) — converted via
   `.toISOString().slice(0, 10)`.
4. Anything unparseable is returned as-is (`validator.service.ts` will then
   flag it as `BR-03-FMT` if it's the issue date, or `BR-DUEDATE-FMT` as a
   warning if it's the due date).

## 8. Worked example

Given a spreadsheet cell layout matching the default template, with:

- `O1 = "Omni Consulting Ltd"`, `O5 = "IE"`, `O6 = "IE1234567T"`
- `A7 = "Acme Retail GmbH"`, `O10 = "DE"`, `I9 = "DE987654321"`
- Row 23 (index 22): `B="Consulting services"`, `D=10`, `M="HUR"`, `F=150`, `O=23`, `N="S"`

`MappingService.apply()` produces:

```json
{
  "seller": { "name": "Omni Consulting Ltd", "countryCode": "IE", "vatNumber": "IE1234567T" },
  "buyer": { "name": "Acme Retail GmbH", "countryCode": "DE", "vatNumber": "DE987654321" },
  "lines": [
    {
      "lineNumber": 1,
      "description": "Consulting services",
      "quantity": 10,
      "unit": "HUR",
      "unitPrice": 150,
      "vatRate": 23,
      "taxCategory": "S",
      "netAmount": 1500,
      "vatAmount": 345
    }
  ]
}
```

See [`invoice-model.md`](./invoice-model.md) for the complete `InvoiceData`
shape and [`examples.md`](./examples.md) for a full worked JSON invoice.
