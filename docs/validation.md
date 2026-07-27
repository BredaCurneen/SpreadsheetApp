# SpreadsheetApp — Validation

This document explains what validation actually happens at each stage of the
pipeline, and — just as importantly — what validation this app **does not**
perform automatically, so nobody assumes a green response means
"certified compliant."

## 1. Validation stages, in pipeline order

```
Spreadsheet upload
      │
      ▼
┌─────────────────────────┐
│ 1. Multer file filter    │  MIME/extension check only (not invoice content)
└──────────┬───────────────┘
           ▼
┌─────────────────────────┐
│ 2. MappingService        │  No validation — best-effort extraction;
│    (cell → InvoiceData)  │  blank/missing cells become empty strings/0
└──────────┬───────────────┘
           ▼
┌─────────────────────────┐
│ 3. ValidatorService      │  App-level EN16931-subset rules (see errors.md §1)
│    (InvoiceData → errs)  │  400 + errors[] returned if any `fatal` found
└──────────┬───────────────┘
           ▼
┌─────────────────────────┐
│ 4. UblService.generate   │  No further validation — assumes ValidatorService
│                          │  already caught structural problems
└──────────┬───────────────┘
           ▼
   UBL XML returned to client
           │
           │ (client sends this XML to a downstream endpoint)
           ▼
┌─────────────────────────┐
│ 5. parseUblToInvoiceData │  Throws 400 if the XML isn't a valid UBL
│    (per downstream       │  <Invoice> document, or has zero lines
│     service)              │
└──────────┬───────────────┘
           ▼
┌─────────────────────────┐
│ 6a. @e-invoice-eu/core    │  ajv JSON Schema validation (xrechnung/zugferd/cii)
│     ajv schema            │  — structural only: required fields, @currencyID
│                            │  companions, array/tuple shapes. Throws → 400.
├─────────────────────────┤
│ 6b. Hand-rolled generator │  facturx.service.ts has NO equivalent schema
│     (no schema check)     │  validation step — it trusts its own mapping code.
└──────────┬───────────────┘
           ▼
   CII / XRechnung XML, or Factur-X / ZUGFeRD PDF returned to client
```

**Nothing in this pipeline runs a full EN16931 Schematron rule set** (the
`BR-*`, `BR-S-*`, `BR-Z-*`, `BR-AE-*`, `BR-IC-*` rules) against the generated
XML. Those rules were satisfied by *fixing the generator code* after manually
running output through a real external validator — they are not re-checked
automatically on every request. See [`errors.md`](./errors.md) for exactly
which rules were addressed this way.

## 2. UBL validation

Performed by `ValidatorService.validate()`, on `InvoiceData`, **before** UBL
is generated. Full rule table in [`errors.md §1`](./errors.md#1-app-level-validation-rules-validatorservicets).

Errors are returned in the `POST /api/convert` response body:

```json
{
  "success": false,
  "message": "Invoice failed EN16931 validation.",
  "errors": [
    { "code": "BR-06", "severity": "fatal", "message": "Invoice shall have a Seller name.", "location": "/Invoice/cac:AccountingSupplierParty/cac:Party" }
  ]
}
```

`warning`-severity entries do **not** block generation — they're returned
alongside a successful `xml` result under the `warnings` key.

## 3. CII validation

There is no dedicated `CiiValidatorService`. Two things happen instead:

1. **`facturx.service.ts`'s hand-rolled CII generator** performs no
   validation of its own — it trusts the `InvoiceData` it receives (already
   passed through `ValidatorService` when the UBL was first generated) and
   just builds XML. If a required field is empty, the generator emits an
   empty XML element rather than raising an error.
2. **`cii.service.ts` / `xrechnung.service.ts` / `zugferd.service.ts`** all
   go through `@e-invoice-eu/core`'s `InvoiceService.generate()`, which
   compiles and runs an ajv schema (`invoiceSchema`, patched per-format via
   each `FormatXxxService.patchSchema()`) against the mapped `Invoice` JSON
   *before* generating XML. A schema violation throws synchronously, is
   caught by the service, and re-thrown as an `AppError` with `statusCode =
   400`, so the controller surfaces it as a structured JSON error rather than
   a raw stack trace or a silent `500`.

## 4. XRechnung validation

Handled identically to CII (above) — `xrechnung.service.ts` uses the same
`@e-invoice-eu/core` ajv schema path with format `'XRECHNUNG-CII'`. The only
XRechnung-specific difference is the `GuidelineSpecifiedDocumentContextParameter`
URN the library writes into the output
(`urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`),
which a real KoSIT validator uses to select its XRechnung-specific rule set.
**This app does not invoke the KoSIT validator.** If full XRechnung
compliance certification is required, run the generated XML through the
[KoSIT validator](https://github.com/itplr-kosit/validator) (Java CLI)
separately — `validator.service.ts` has a comment noting this as a natural
extension point.

## 5. ZUGFeRD XML validation

Same ajv-schema layer as CII/XRechnung, via `zugferd.service.ts` with format
`'ZUGFeRD-EN16931'` (normalised internally to `'factur-x-en16931'`). No
additional ZUGFeRD-specific structural checks are added on top — the
EN16931-profile Factur-X format service (`FormatFacturXEN16931Service`) uses
the same `FormatCIIService.patchSchema()` (a no-op) as plain CII, so the same
ajv schema applies.

## 6. PDF/A-3 validation

This is the area with the biggest gap between "what this app checks" and
"full compliance." Neither PDF generation path runs a PDF/A-3 conformance
checker (e.g. veraPDF) — they were verified **manually**, once, during
development, by loading the generated PDF back with `pdf-lib` and inspecting
its catalog directly:

```ts
doc.catalog.has(PDFName.of('AF'));            // Associated Files array present?
doc.catalog.has(PDFName.of('Metadata'));       // XMP metadata stream present?
doc.catalog.has(PDFName.of('OutputIntents'));  // ICC OutputIntent present?
doc.catalog.has(PDFName.of('StructTreeRoot')); // PDF/A tagging root present?
```

| Structural element | `facturx.service.ts` (hand-rolled) | `zugferd.service.ts` (`@e-invoice-eu/core`) |
|---|---|---|
| `/AF` (embedded file, correct `AFRelationship`) | ✅ `Data` | ✅ `Alternative` |
| `/Metadata` (XMP, incl. `fx:` Factur-X namespace) | ✅ hand-built | ✅ library-built |
| `/OutputIntents` (ICC profile) | ⚠️ **only if** `backend/assets/sRGB.icc` is manually placed on disk — otherwise silently omitted with a `logger.warn()` | ✅ always — library bundles a real base64 sRGB profile |
| `/StructTreeRoot`, `/MarkInfo` (PDF/A tagging) | ❌ not implemented | ✅ implemented |

**Neither path is veraPDF-certified.** For a legally binding compliance
guarantee (e.g. for Chorus Pro or another mandatory e-invoicing portal), run
the output PDF through [veraPDF](https://verapdf.org/) or an equivalent
accredited validator before relying on it in production. The ZUGFeRD path
(`@e-invoice-eu/core`) is materially closer to full compliance than the
hand-rolled Factur-X path, per the table above.

## 7. How validation errors are surfaced in the UI

Every tab component follows the same pattern (see e.g.
`upload.component.ts`, `xrechnung.component.ts`):

```ts
errors = signal<ValidationError[]>([]);
errorMessage = signal<string | null>(null);
```

- **Structured validation errors** (from `POST /api/convert`'s `errors[]`
  array) are rendered as a list, each with its `code` and `message`, inside
  an `.alert.alert-error` box.
- **Everything else** (network failures, `400`/`500` responses from the
  downstream `/facturx`, `/xrechnung`, `/zugferd`, `/cii` endpoints, or
  unexpected exceptions) is caught in the component's `try/catch` and shown
  as a single `errorMessage` string in the same alert style.
- `InvoiceService`'s HTTP methods normalise the different Angular
  `HttpClient` response-type quirks (`blob`, `text`, `json`) so that whatever
  the backend sends back as an error body — JSON, a `Blob` wrapping JSON, or
  a `text` string containing JSON — ends up as a plain `Error` with a
  human-readable `.message`, via `catchError` operators in
  `invoice.service.ts`.

No validation errors are ever silently swallowed in the frontend — every
`catch` block sets a signal that the template renders.
