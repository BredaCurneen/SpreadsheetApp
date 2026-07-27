# SpreadsheetApp — Error & Business Rule Reference

This app has **two distinct layers** of error checking, and it's important
not to conflate them:

1. **App-level pre-flight validation** (`validator.service.ts`) — runs on the
   in-memory `InvoiceData` object immediately after spreadsheet mapping,
   *before* any XML is generated. Implemented in plain TypeScript. Returns a
   `ValidationError[]`; a `fatal` entry aborts the request with `400`.
2. **EN16931 / CII / XRechnung Schematron business rules** (`BR-*`,
   `BR-S-*`, `BR-Z-*`, `BR-AE-*`, `BR-IC-*`, etc.) — these are the official
   EN16931 rules enforced by real validators like the KoSIT XRechnung
   validator, Chorus Pro, or veraPDF. **This app does not run a Schematron
   engine itself.** The specific fixes documented below (BR-AE-02, BR-S-02,
   BR-Z-02, BR-IC-12) were discovered *reactively*, by running generated XML
   through an external validator and fixing the mapping code that produced
   bad output — not by an automated internal check. `validator.service.ts`
   contains a comment noting this and suggesting a Saxon-JS or KoSIT
   validator CLI integration as a future improvement.

---

## 1. App-level validation rules (`validator.service.ts`)

These run on every `POST /api/convert` call. Codes prefixed `BR-` here mirror
common EN16931 rule numbers but are a **hand-picked subset**, not the full
official rule set.

| Code | Severity | Rule |
|---|---|---|
| `BR-02` | fatal | Invoice must have an ID (`invoice.id`) |
| `BR-03` | fatal | Invoice must have an issue date |
| `BR-03-FMT` | fatal | Issue date must be ISO 8601 (`YYYY-MM-DD`) |
| `BR-DUEDATE-FMT` | warning | Due date, if present, must be ISO 8601 |
| `BR-04` | fatal | Invoice must have a type code |
| `BR-05` | fatal | Invoice must have a currency code |
| `BR-05-FMT` | fatal | Currency code must be ISO 4217 (3 uppercase letters) |
| `BR-06` | fatal | Seller must have a name |
| `BR-08` | fatal | Seller postal address must have street, city, and postal code |
| `BR-09` | fatal | Seller postal address must have a country code |
| `BR-09-FMT` | fatal | Seller country code must be ISO 3166-1 alpha-2 |
| `BR-14` | warning | Seller VAT identifier is missing |
| `BR-07` | fatal | Buyer must have a name |
| `BR-10` | fatal | Buyer postal address must have street, city, and postal code |
| `BR-11` | fatal | Buyer postal address must have a country code |
| `BR-11-FMT` | fatal | Buyer country code must be ISO 3166-1 alpha-2 |
| `BR-12` | fatal | Invoice must have at least one line |
| `BR-24` | fatal | Each line must have a description |
| `BR-15` | fatal | Each line's invoiced quantity must not be zero |
| `BR-26` | fatal | Each line's unit price must be greater than zero |
| `BR-CAT` | fatal | Line tax category must be one of `S, Z, E, AE, K, O` |
| `BR-Z-1` / `BR-E-1` / `BR-AE-1` / `BR-K-1` / `BR-O-1` | fatal | Zero-rate categories (`Z`, `E`, `AE`, `K`, `O`) must carry a 0% VAT rate |
| `BR-CO-10` | fatal | Sum of line net amounts must match the header net amount (±0.02 tolerance) |
| `BR-CO-15` | fatal | Computed gross (net + tax) must match the header gross amount (±0.02 tolerance) |

All of these produce a structured entry:

```ts
interface ValidationError {
  code: string;
  severity: 'fatal' | 'warning';
  message: string;
  location?: string; // an XPath-like pointer, e.g. "/Invoice/cac:InvoiceLine[2]"
}
```

## 2. UBL / PEPPOL business rules implemented directly in the generator

`ubl.service.ts` doesn't just build XML — it actively satisfies several
PEPPOL BIS 3 / EN16931 rules as part of generation, rather than merely
validating for them:

| Rule | How `ubl.service.ts` satisfies it |
|---|---|
| `PEPPOL-EN16931-R020` / `R010` | Always emits `cbc:EndpointID` for both parties, resolved from an explicit mapping or derived from the VAT number + a per-country EAS scheme table |
| `BR-IC-11` | Emits `cac:InvoicePeriod` or `cac:Delivery/cbc:ActualDeliveryDate` whenever any line has tax category `K` |
| `BR-IC-12` | Emits `cac:Delivery/cac:DeliveryLocation/cac:Address/cac:Country` for `K`-category invoices, defaulting to the **buyer's** country when no explicit delivery country is mapped |
| `BR-AE-10` / `BR-IC-10` | Emits `cbc:TaxExemptionReasonCode` / `cbc:TaxExemptionReason` for `AE` and `K` categories (and `E`, `O`) — but correctly omits them for `Z`, per `BR-Z-10` |
| `DE-R-026` | Emits `cac:BillingReference/cac:InvoiceDocumentReference` when `typeCode = '384'` (credit/corrected invoice) and a preceding invoice ID is present |
| `DE-R-002` | Emits `cac:Contact` only when at least one seller contact field is present |
| `DE-R-010` / `DE-R-011` | When `cac:DeliveryLocation` is emitted, always includes `CityName`/`PostalZone`, defaulting to the buyer's if no explicit delivery address is mapped |

## 3. CII / XRechnung / ZUGFeRD business rules fixed during development

These rules apply to the **CII syntax** output produced by
`xrechnung.service.ts`, `zugferd.service.ts`, `cii.service.ts` (via
`@e-invoice-eu/core`) and by `facturx.service.ts` (hand-rolled). They were
found via real KoSIT/EN16931 validator feedback, not by an in-app check.

### BR-S-02 / BR-Z-02

> Standard-rated (`S`) and zero-rated (`Z`) lines require the **Seller VAT
> identifier (BT-31)**, **Seller Tax Registration identifier (BT-32)**, or
> **Seller Tax Representative VAT identifier (BT-63)**.

**Root cause found:** the seller's VAT number was mapped into
`cac:PartyLegalEntity/cbc:CompanyID` (BT-30, a *different* business term —
the legal registration identifier) instead of `cac:PartyTaxScheme` (BT-31,
which the CII syntax maps to `SpecifiedTaxRegistration`). The VAT number was
present in the XML, just in the wrong element, so a Schematron check looking
specifically for `SpecifiedTaxRegistration` failed.

**Fix:** `buildSellerParty()` (duplicated in `xrechnung.service.ts`,
`zugferd.service.ts`, `cii.service.ts`) now emits:

```xml
<ram:SellerTradeParty>
  <ram:SpecifiedTaxRegistration>
    <ram:ID schemeID="VA">IE1234567T</ram:ID>
  </ram:SpecifiedTaxRegistration>
</ram:SellerTradeParty>
```

### BR-AE-02

> Reverse-charge (`AE`) lines require **both**: (Seller VAT ID **or** Seller
> Tax Reg ID **or** Seller Tax Rep VAT ID) **and** (Buyer VAT ID **or** Buyer
> Legal Registration ID).

**Fix:** seller side uses the same `PartyTaxScheme` fix as above. Buyer side
(`buildBuyerParty()`) prefers `cac:PartyTaxScheme` when a buyer VAT number is
present, and only falls back to `cac:PartyLegalEntity/cbc:CompanyID` (→
`SpecifiedLegalOrganization`) when it's absent — this correctly matches the
rule's "VAT ID **or** Legal Registration ID" alternative.

### BR-IC-12 (CII path)

> In an invoice with VAT category `K` ("Intra-community supply"), the
> Deliver-to country code must not be blank, at
> `.../ApplicableHeaderTradeDelivery/ShipToTradeParty/PostalTradeAddress/CountryID`.

**Root cause found:** the CII generator (`facturx.service.ts`'s
`buildCiiXml`) only ever populated `ApplicableHeaderTradeDelivery` with an
`ActualDeliverySupplyChainEvent` (a delivery date) — it never emitted
`ShipToTradeParty` at all.

**Fix:** whenever any line's tax category is `K`, the generator now emits:

```xml
<ram:ApplicableHeaderTradeDelivery>
  <ram:ShipToTradeParty>
    <ram:PostalTradeAddress>
      <ram:CountryID>IE</ram:CountryID>
    </ram:PostalTradeAddress>
  </ram:ShipToTradeParty>
</ram:ApplicableHeaderTradeDelivery>
```

**Fallback chain used:** spreadsheet's "Deliver To Country" column
(`invoice.delivery.countryCode`) → seller's country → literal `"IE"`.

> **Known interaction:** because `ubl.service.ts` (upstream, unmodified)
> already fills the delivery country with the **buyer's** country whenever a
> `K` line exists, and every downstream CII/XRechnung/ZUGFeRD service derives
> its data by re-parsing that UBL, the "fall back to seller" tier in the CII
> path rarely triggers in practice — by the time CII generation runs, a
> country is usually already present (the buyer's). Both are valid,
> non-blank country codes, so `BR-IC-12` is satisfied either way; only the
> *specific* country chosen differs from what a literal reading of the
> fallback spec above would suggest.

## 4. `@e-invoice-eu/core` ajv schema errors

Distinct from the Schematron-level `BR-*` rules above, the library's own ajv
JSON Schema enforces **structural** requirements before it will generate
anything. The most common one encountered during development:

```json
{
  "instancePath": "/ubl:Invoice/cac:TaxTotal/0/cac:TaxSubtotal/0",
  "keyword": "dependentRequired",
  "params": { "missingProperty": "cbc:TaxableAmount@currencyID" },
  "message": "must have property cbc:TaxableAmount@currencyID when property cbc:TaxableAmount is present"
}
```

Every monetary amount field in the library's `Invoice` JSON model requires a
sibling `@currencyID` property (e.g. `cbc:TaxableAmount` needs
`cbc:TaxableAmount@currencyID`, `cbc:PriceAmount` needs
`cbc:PriceAmount@currencyID`, etc.). `xrechnung.service.ts`,
`zugferd.service.ts`, and `cii.service.ts` all set these on every amount
field they emit. If you add a new amount field to the mapping, remember the
`@currencyID` sibling or generation will throw and the controller will
surface it as a `400` with the raw ajv message.

## 5. App-level (non-business-rule) errors

| Situation | Where raised | HTTP status |
|---|---|---|
| No file in the upload | `convert.controller.ts`, `pdfExtract.controller.ts` | 400 |
| Unsupported spreadsheet type/extension | `upload.middleware.ts` (multer `fileFilter`) | 400 |
| Unsupported PDF type/extension | `pdf-extract.route.ts` (local multer instance) | 400 |
| File exceeds size limit | `multer` (`MulterError`, caught in `error.middleware.ts`) | 413 |
| Mapped sheet name not found in workbook | `convert.controller.ts` | 400 |
| `xml` field missing/non-string in a `{xml}`-body endpoint | each `*.controller.ts` | 400 |
| Input XML is not a valid UBL `Invoice` document | `parseUblToInvoiceData()` in each service | 400 |
| UBL invoice has zero lines | `parseUblToInvoiceData()` (xrechnung/zugferd/cii) | 400 |
| PDF has no embedded attachments | `pdfExtract.service.ts` | 400 |
| PDF has embedded attachments but none look like XML | `pdfExtract.service.ts` | 400 |
| Unhandled/unexpected exception | `error.middleware.ts` catch-all | 500 (message hidden from client) |

## 6. How the app "auto-fixes" issues (vs. just reporting them)

A few situations are silently resolved with sensible defaults rather than
raising an error:

- **Missing invoice type code** → defaults to `'380'` (commercial invoice).
- **Missing currency code** → defaults to `'EUR'`.
- **Missing/unrecognised line unit code** → defaults to `'C62'` (UN/ECE "one").
- **Missing per-line tax category** → derived as `S` if `vatRate > 0`, else `Z`.
- **Non-ISO spreadsheet dates** (`DD/MM/YYYY`, `MM/DD/YYYY`, or anything
  `Date`-parseable) → normalised to `YYYY-MM-DD` by
  `MappingService.normaliseDate()`.
- **Missing Seller/Buyer VAT number** (CII/XRechnung/ZUGFeRD paths only) →
  falls back to the literal placeholder `"NA"` so `BR-S-02`/`BR-Z-02`/
  `BR-AE-02` are never failed by an *absent* element — a `logger.warn()` is
  emitted every time this triggers, since it's a last resort, not a real fix.
