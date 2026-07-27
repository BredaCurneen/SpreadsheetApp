# SpreadsheetApp — Architecture

## 1. Overview

SpreadsheetApp converts spreadsheet invoices into standards-compliant e-invoicing
formats. The pipeline is:

```
Spreadsheet (.xlsx / .ods / .csv)
        │
        ▼
  Cell matrix (SheetJS)
        │
        ▼
  InvoiceData (internal JSON model)
        │
        ▼
  UBL 2.1 XML (PEPPOL BIS 3)  ◄── hand-rolled generator, the app's "source of truth" XML
        │
        ├──► Factur-X-style PDF/A-3  (hand-rolled: pdf-lib + xmlbuilder2 CII)
        ├──► XRechnung XML           (real @e-invoice-eu/core, CII syntax)
        ├──► ZUGFeRD PDF/A-3         (real @e-invoice-eu/core, Factur-X engine)
        └──► Plain CII XML           (real @e-invoice-eu/core)

  PDF (any of the above, or a third-party ZUGFeRD/Factur-X PDF)
        │
        ▼
  Extracted embedded XML (pdfjs-dist)
```

Two independent CII-generation code paths exist in this codebase — see
[§4.3](#43-two-independent-cii-code-paths-important) for why, and which one
each feature uses.

## 2. Frontend (Angular 20, standalone components)

```
src/app/
├── app.ts                     — root shell: tab navigation + <router-outlet>
├── app.routes.ts              — route table (one route per tab)
├── app.config.ts              — providers: HttpClient (fetch), Router
├── services/
│   └── invoice.service.ts     — single HttpClient wrapper for every backend endpoint
└── components/
    ├── upload/                — Spreadsheet → UBL XML  (path: /)
    ├── facturx/                — UBL → Factur-X-style PDF/A-3  (path: /facturx)
    ├── pdf-extract/            — PDF → extracted embedded XML  (path: /pdf-extract)
    ├── xrechnung/              — UBL → XRechnung XML  (path: /xrechnung)
    ├── zugferd/                — UBL → ZUGFeRD PDF/A-3  (path: /zugferd)
    └── cii/                    — UBL → plain CII XML  (path: /cii)
```

Every tab after the first follows the same two-step UX pattern:

1. Upload a spreadsheet and click **Convert to XML** — calls
   `InvoiceService.convert()` → `POST /api/convert`, which returns UBL XML.
2. Click the tab's generate button (e.g. **Generate XRechnung XML**) — sends
   that UBL XML to the tab's dedicated endpoint, which converts it further.

This means every downstream format (Factur-X, XRechnung, ZUGFeRD, CII) is
derived **from the UBL XML**, not from a second copy of the original
spreadsheet. The backend re-parses the UBL back into `InvoiceData` internally
(see [§4.2](#42-the-ubl-reversal-pattern)) rather than re-reading the
spreadsheet.

### Component tree (tab bar)

```
App (root shell)
 ├─ nav: Convert to UBL | Factur-X PDF | Extract XML from PDF | XRechnung | ZUGFeRD PDF | CII XML
 └─ <router-outlet>
     ├─ UploadComponent      (spreadsheet → UBL XML)
     ├─ FacturxComponent     (spreadsheet → UBL → Factur-X PDF)
     ├─ PdfExtractComponent  (PDF → embedded XML)
     ├─ XRechnungComponent   (spreadsheet → UBL → XRechnung XML)
     ├─ ZugferdComponent     (spreadsheet → UBL → ZUGFeRD PDF, with embedded-XML preview)
     └─ CiiComponent         (spreadsheet → UBL → CII XML)
```

## 3. Backend (Node.js + Express, TypeScript)

```
backend/src/
├── server.ts                        — Express app, CORS, JSON body parser, route mounting
├── controllers/                     — one per endpoint; thin, delegate to services
│   ├── convert.controller.ts
│   ├── facturx.controller.ts
│   ├── pdfExtract.controller.ts
│   ├── xrechnung.controller.ts
│   ├── zugferd.controller.ts
│   └── cii.controller.ts
├── services/                        — all business logic lives here
│   ├── spreadsheet.service.ts       — SheetJS wrapper: buffer → cell matrix
│   ├── mapping.service.ts           — cell matrix + mapping.json → InvoiceData
│   ├── validator.service.ts         — InvoiceData → ValidationError[] (pre-generation)
│   ├── ubl.service.ts               — InvoiceData → UBL 2.1 XML (hand-rolled, xmlbuilder2)
│   ├── facturx.service.ts           — UBL XML → Factur-X-style PDF/A-3 (hand-rolled)
│   ├── pdfExtract.service.ts        — PDF → embedded XML (pdfjs-dist)
│   ├── xrechnung.service.ts         — UBL XML → XRechnung XML (@e-invoice-eu/core)
│   ├── zugferd.service.ts           — UBL XML → ZUGFeRD PDF/A-3 (@e-invoice-eu/core)
│   └── cii.service.ts               — UBL XML → plain CII XML (@e-invoice-eu/core)
├── routes/                          — one Express Router per endpoint, mounted at /api
├── middleware/
│   ├── upload.middleware.ts         — multer memory storage, spreadsheet MIME/extension filter
│   └── error.middleware.ts          — centralised error handler (AppError.statusCode → HTTP status)
├── types/
│   └── invoice.types.ts             — InvoiceData, InvoiceParty, InvoiceLineItem, MappingConfig, …
└── utils/
    └── logger.ts                    — winston logger
```

### Request routing

All routers are mounted under the `/api` prefix in `server.ts`:

| Method | Path                    | Router file             |
|--------|-------------------------|--------------------------|
| POST   | `/api/convert`          | `routes/convert.route.ts` |
| POST   | `/api/facturx/pdf`      | `routes/facturx.route.ts` |
| POST   | `/api/pdf/extract-xml`  | `routes/pdf-extract.route.ts` |
| POST   | `/api/xrechnung/generate` | `routes/xrechnung.route.ts` |
| POST   | `/api/zugferd/generate`   | `routes/zugferd.route.ts` |
| POST   | `/api/cii/generate`       | `routes/cii.route.ts` |
| GET    | `/health`               | inline in `server.ts` |

Full request/response details are in [`api-endpoints.md`](./api-endpoints.md).

## 4. Modules

### 4.1 UBL (the "source of truth" generator)

`ubl.service.ts` hand-builds UBL 2.1 / PEPPOL BIS 3 XML directly from
`InvoiceData` using `xmlbuilder2`. It is the **only** generator that reads
`InvoiceData` directly — every other format is derived from *its* XML output.
It implements PEPPOL-specific business rules itself (EAS endpoint resolution,
BR-IC-11/BR-IC-12 delivery-country fallback for intra-community supply,
tax-exemption reason codes, credit-note handling, etc.). See
[`ubl.service.ts`](../backend/src/services/ubl.service.ts) for the full rule
set — it is intentionally left unmodified by all newer features in this app.

### 4.2 The UBL-reversal pattern

`facturx.service.ts`, `xrechnung.service.ts`, `zugferd.service.ts`, and
`cii.service.ts` never touch the spreadsheet or `mapping.service.ts`. Instead,
each one:

1. Parses the UBL XML it's handed (via `fast-xml-parser`, with
   `removeNSPrefix: true`) back into an `InvoiceData` object.
2. Re-maps that `InvoiceData` into whatever shape the target format needs.
3. Generates the target format.

This keeps every new format additive — none of them import from or modify
`ubl.service.ts` — at the cost of some duplicated UBL-parsing logic across the
four files (each is intentionally self-contained rather than sharing a
module, per how each feature was scoped).

### 4.3 Two independent CII code paths (important)

There are **two separate implementations** that both produce CII XML:

| | `facturx.service.ts` | `xrechnung.service.ts` / `zugferd.service.ts` / `cii.service.ts` |
|---|---|---|
| CII XML built by | Hand-rolled `xmlbuilder2` calls in this repo | The real `@e-invoice-eu/core` library (`InvoiceService.generate()`) |
| PDF/A-3 built by | Hand-rolled `pdf-lib` calls in this repo | `@e-invoice-eu/core`'s `FormatFacturXService` (for ZUGFeRD only) |
| ICC OutputIntent | Only if `backend/assets/sRGB.icc` is manually placed on disk; otherwise silently omitted | Always present — the library bundles a real base64 sRGB profile |
| PDF/A tagging (`StructTreeRoot`, `MarkInfo`) | Not implemented | Implemented (ZUGFeRD path only) |
| Used by endpoint | `POST /api/facturx/pdf` | `POST /api/xrechnung/generate`, `POST /api/zugferd/generate`, `POST /api/cii/generate` |

`facturx.service.ts` was built first, before the project confirmed that
`@e-invoice-eu/core` (the real `gflohr/e-invoice-eu` package) was available
and usable. It remains in place, unmodified, per this app's "don't touch
existing generators" convention — but it is the **less complete** of the two
PDF/A-3 implementations. New PDF/A-3 work should prefer the
`@e-invoice-eu/core`-based pattern used in `zugferd.service.ts`.

### 4.4 Validators

- **`validator.service.ts`** — runs once, synchronously, on `InvoiceData`
  immediately after spreadsheet mapping and before UBL generation. Returns a
  flat `ValidationError[]` (severity `fatal` or `warning`). A `fatal` error
  aborts the request with `400` before any XML is produced. See
  [`errors.md`](./errors.md) and [`validation.md`](./validation.md) for the
  full rule list and how it differs from EN16931 Schematron validation.
- **ajv schema validation** — internal to `@e-invoice-eu/core`. Runs whenever
  `xrechnung.service.ts` / `zugferd.service.ts` / `cii.service.ts` call
  `InvoiceService.generate()`. Enforces the library's JSON Schema (required
  fields, `@currencyID` companions, array/tuple cardinalities). Thrown errors
  are caught and re-surfaced as `400` with the ajv message.

### 4.5 Extractors

`pdfExtract.service.ts` uses `pdfjs-dist` (loaded via dynamic `import()`,
since v6 ships ESM-only) to read a PDF's `/Names/EmbeddedFiles`, and returns
the first attachment matching `factur-x.xml`, `zugferd-invoice.xml`,
`xrechnung.xml`, or any `.xml` file, as UTF-8 text.

## 5. End-to-end data flow diagram

```
┌─────────────┐   POST /api/convert (multipart)   ┌────────────────────┐
│   Angular    │ ─────────────────────────────────▶│ SpreadsheetService │
│  (Upload /   │                                    │  → cell matrix     │
│  any tab)    │                                    └─────────┬──────────┘
│              │                                              ▼
│              │                                    ┌────────────────────┐
│              │                                    │  MappingService    │
│              │                                    │  → InvoiceData     │
│              │                                    └─────────┬──────────┘
│              │                                              ▼
│              │                                    ┌────────────────────┐
│              │                                    │ ValidatorService   │
│              │                                    │ 400 if fatal errors│
│              │                                    └─────────┬──────────┘
│              │                                              ▼
│              │                                    ┌────────────────────┐
│              │◀────────────── { xml } ────────────│   UblService       │
└──────┬───────┘                                    └────────────────────┘
       │
       │ POST /api/{facturx/pdf | xrechnung/generate | zugferd/generate | cii/generate}
       │        body: { xml }  (the UBL XML from the previous step)
       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  {facturx|xrechnung|zugferd|cii}.service.ts                          │
│   1. parseUblToInvoiceData(xml)   — fast-xml-parser reversal          │
│   2. toEInvoiceEuInvoice(invoice) — map to target JSON shape          │
│   3. generate → CII XML / XRechnung XML / PDF/A-3                    │
└──────────────────────────────────────────────────────────────────────┘
       │
       ▼
  Response: application/xml or application/pdf, with Content-Disposition
```

## 6. Key third-party dependencies

| Package | Used by | Purpose |
|---|---|---|
| `xlsx` | `spreadsheet.service.ts` | Parse .xlsx/.ods/.csv into a cell matrix |
| `xmlbuilder2` | `ubl.service.ts`, `facturx.service.ts` | Hand-rolled XML construction |
| `pdf-lib` | `facturx.service.ts`, `zugferd.service.ts` | PDF/A-3 construction, attachment embedding |
| `pdfjs-dist` | `pdfExtract.service.ts` | Read embedded files back out of a PDF |
| `fast-xml-parser` | `facturx.service.ts`, `xrechnung.service.ts`, `zugferd.service.ts`, `cii.service.ts` | Reverse-parse generated UBL back into `InvoiceData` |
| `@e-invoice-eu/core` | `xrechnung.service.ts`, `zugferd.service.ts`, `cii.service.ts` | Real EN16931/UBL/CII/XRechnung/Factur-X/ZUGFeRD generator (`gflohr/e-invoice-eu`) |
| `multer` | `upload.middleware.ts`, `routes/pdf-extract.route.ts` | Multipart file upload handling |
| `winston` | `utils/logger.ts` | Structured logging |

**Note on package names:** there is no `@e-invoice-eu/ubl`, `@e-invoice-eu/cii`,
`@e-invoice-eu/xrechnung`, `@e-invoice-eu/zugferd`, `@e-invoice-eu/factur-x`,
or `@e-invoice-eu/pdf` package. All of UBL, CII, XRechnung, Factur-X, and
ZUGFeRD generation inside `@e-invoice-eu/core` are exposed as **format
strings** (`'UBL'`, `'CII'`, `'XRECHNUNG-CII'`, `'XRECHNUNG-UBL'`,
`'Factur-X-EN16931'`, `'ZUGFeRD-EN16931'`, …) passed to one class,
`InvoiceService.generate(invoice, { format, lang })`. The library's own
`normalizeFormat()` even rewrites any `'zugferd-*'` string to `'factur-x-*'`
internally, confirming ZUGFeRD ≥2.0 and Factur-X are the same technical
standard as far as this package is concerned.
