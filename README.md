# SpreadsheetApp

**Turn a spreadsheet invoice into every EU e-invoicing format you need — UBL, CII, XRechnung, and ZUGFeRD — plus PDF/A-3 generation and extraction, in one Angular + Node.js app.**

SpreadsheetApp takes an invoice authored in a plain `.xlsx`, `.ods`, or `.csv`
spreadsheet and converts it into standards-compliant EU e-invoice output:

- **UBL 2.1 XML** (PEPPOL BIS Billing 3.0)
- **CII XML** (UN/CEFACT Cross Industry Invoice, EN 16931)
- **XRechnung XML** (the German public-sector EN 16931 profile, CII syntax)
- **ZUGFeRD PDF/A-3** and **Factur-X-style PDF/A-3** — human-readable PDF
  invoices with the machine-readable XML embedded inside them
- **XML extraction** — pull the embedded XML back out of any ZUGFeRD/Factur-X
  PDF you're given

Every conversion is backed by EN 16931 business-rule validation, so mapping
and data errors are caught and reported before a single line of output is
generated — not discovered later at the customer's e-invoicing portal.

It's built for:

- **Developers** integrating or extending EU e-invoicing support into an
  existing spreadsheet-based workflow, without hand-rolling XML generators.
- **Finance / AP teams** who need to turn existing invoice spreadsheets into
  the exact XML or PDF/A-3 format a customer, tax authority, or e-invoicing
  network (PEPPOL, Chorus Pro, XRechnung) requires.
- Anyone building or testing **EU e-invoicing workflows** who wants a working
  reference implementation of the full spreadsheet → JSON → XML → PDF/A-3
  pipeline.

---

## Key Features

| Feature | Description |
|---|---|
| **Spreadsheet → JSON conversion** | Parses `.xlsx` / `.ods` / `.csv` into a structured internal invoice model via a configurable cell mapping |
| **JSON → UBL XML** | Generates PEPPOL BIS Billing 3.0 / UBL 2.1 XML, including PEPPOL endpoint resolution and EN 16931 business-rule compliance |
| **JSON → CII XML** | Generates plain UN/CEFACT CII XML (EN 16931), via the real `@e-invoice-eu/core` library |
| **JSON → XRechnung XML** | Generates the German XRechnung 3.0 profile in CII syntax |
| **JSON → ZUGFeRD PDF/A-3** | Generates a ZUGFeRD 2.x / Factur-X PDF/A-3 hybrid invoice with embedded CII XML, real ICC colour profile, and PDF/A structure tagging |
| **PDF → XML extraction** | Uploads any ZUGFeRD/Factur-X PDF and extracts its embedded invoice XML back out as text |
| **XML validation** | EN 16931 business-rule checks run before generation; structural schema validation runs during CII/XRechnung/ZUGFeRD generation |
| **Download & copy XML** | Every generated XML/PDF can be copied to the clipboard or downloaded as a file directly from the UI |
| **Multi-tab Angular UI** | One tab per conversion path — Convert to UBL, Factur-X PDF, Extract XML from PDF, XRechnung, ZUGFeRD PDF, CII XML |
| **Node.js API** | A small, focused REST API — one endpoint per conversion — that the Angular app (or any other client) can call directly |
| **Mapping system** | Spreadsheet columns and cells map to invoice fields via an editable JSON mapping config, not hard-coded parsing logic |

---

## Architecture Overview

SpreadsheetApp is a two-tier application: an Angular single-page app talking
to a small Express API over HTTP.

- **Frontend (Angular 20, standalone components)** — one route/component per
  conversion path, all sharing a single `InvoiceService` for HTTP calls.
- **Backend (Node.js + Express, TypeScript)** — one controller/service/route
  per endpoint. Every format generator re-derives its output from the UBL XML
  produced by the first step, rather than re-reading the spreadsheet.
- **Generators** — `ubl.service.ts` (hand-rolled, the "source of truth"),
  `cii.service.ts` / `xrechnung.service.ts` / `zugferd.service.ts` (all
  powered by the real `@e-invoice-eu/core` library), and
  `facturx.service.ts` (an earlier, hand-rolled PDF/A-3 + CII implementation
  kept alongside the newer library-backed one).
- **Validators** — an EN 16931-subset business-rule checker
  (`validator.service.ts`) runs before UBL generation; `@e-invoice-eu/core`'s
  own JSON-schema validation runs during CII/XRechnung/ZUGFeRD generation.
- **Extractors** — `pdfExtract.service.ts` reads embedded XML back out of any
  PDF/A-3 via `pdfjs-dist`.
- **PDF/A-3 module** — two parallel implementations build the PDF/A-3
  container: a hand-rolled one (`pdf-lib` + manual XMP) and a library-backed
  one (`@e-invoice-eu/core`'s Factur-X/ZUGFeRD engine, which bundles a real
  ICC profile and full PDF/A structure tagging).

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Angular frontend (:4200)                     │
│  Upload │ Factur-X │ Extract XML │ XRechnung │ ZUGFeRD │ CII  tabs   │
└──────────────────────────────┬────────────────────────────────────┘
                                │ HTTP (InvoiceService)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Node.js / Express backend (:3000)                │
│                                                                       │
│   Spreadsheet ──▶ SpreadsheetService ──▶ MappingService ──▶ Invoice  │
│                                                        │      Data   │
│                                                        ▼             │
│                                              ValidatorService        │
│                                                        │             │
│                                                        ▼             │
│                                                  UblService           │
│                                                        │             │
│                                                        ▼             │
│                                                    UBL XML            │
│                                                        │             │
│              ┌─────────────────┬──────────────────────┼──────────┐  │
│              ▼                 ▼                      ▼          ▼  │
│      FacturxService     XRechnungService      ZugferdService  CiiService │
│      (hand-rolled       (@e-invoice-eu/core)  (@e-invoice-eu   (@e-invoice- │
│       PDF/A-3 + CII)                           /core)           eu/core)  │
│              │                 │                      │          │  │
│              ▼                 ▼                      ▼          ▼  │
│         Factur-X PDF      XRechnung XML          ZUGFeRD PDF   CII XML │
│                                                                       │
│                          PdfExtractService (pdfjs-dist)               │
│                          PDF ──▶ extracted embedded XML                │
└─────────────────────────────────────────────────────────────────────┘
```

See [`docs/architecture.md`](./docs/architecture.md) for the full breakdown,
including why two independent CII/PDF-A-3 implementations exist side by side.

---

## Installation

**Prerequisites:** Node.js 22+ and npm.

```bash
# 1. Clone the repository
git clone <your-repository-url>
cd SpreadsheetApp

# 2. Install frontend dependencies (run from the repo root)
npm install

# 3. Install backend dependencies
cd backend
npm install
cd ..
```

### Running in development

Two servers run side by side — the Angular dev server and the Express API.

```bash
# Terminal 1 — backend API (http://localhost:3000)
cd backend
npm run dev

# Terminal 2 — Angular dev server (http://localhost:4200)
npm start
```

Open `http://localhost:4200` in a browser. The frontend calls the backend
directly at `http://localhost:3000/api` (see `src/app/services/invoice.service.ts`);
a matching `proxy.conf.json` is also wired into `ng serve` if you prefer to
route API calls through the dev server instead.

### Building for production

```bash
# Frontend — outputs to dist/spreadsheetApp
npm run build

# Backend — compiles TypeScript to backend/dist
cd backend
npm run build
npm start   # runs node dist/server.js
```

Set `PORT` and `FRONTEND_ORIGIN` environment variables to configure the
backend's listen port and allowed CORS origin in production (see
`backend/src/server.ts`).

---

## Folder Structure

```
SpreadsheetApp/
├── src/                    # Angular frontend application (project root doubles as /frontend)
│   └── app/
│       ├── components/     # One folder per tab: upload, facturx, pdf-extract, xrechnung, zugferd, cii
│       ├── services/       # invoice.service.ts — the single HttpClient wrapper used by every tab
│       ├── app.routes.ts   # Route table, one route per tab
│       └── app.ts          # Root shell: tab navigation + <router-outlet>
├── public/                 # Static assets served as-is by the Angular build
├── backend/                # Node.js + Express API
│   ├── src/
│   │   ├── controllers/    # One per endpoint — thin, delegate to services
│   │   ├── services/       # All business logic: mapping, validation, generation, extraction
│   │   ├── routes/         # One Express Router per endpoint, mounted under /api
│   │   ├── middleware/     # Multer upload handling, centralised error handling
│   │   ├── types/          # invoice.types.ts — the shared InvoiceData model
│   │   └── utils/          # Logger
│   ├── mappings/           # default-invoice-mapping.json — spreadsheet → field mapping config
│   └── assets/             # Optional: place a real sRGB ICC profile here for full PDF/A-3 compliance
├── docs/                   # Detailed reference documentation (see below)
├── angular.json             # Angular CLI workspace config
├── proxy.conf.json          # Optional dev-server proxy from /api to the backend
└── package.json             # Frontend dependencies and npm scripts
```

> This project doesn't use a top-level `/frontend` or `/scripts` folder — the
> Angular app lives at the repository root (standard Angular CLI layout), and
> there are currently no standalone build/deploy scripts outside the two
> `package.json` files' own `scripts` sections.

---

## API Overview

All backend endpoints are mounted under `/api` on the Express server
(`http://localhost:3000/api` in development). Full request/response details,
headers, and error shapes are in [`docs/api-endpoints.md`](./docs/api-endpoints.md).

> **Note:** the backend does not expose `POST /api/ubl/generate` as a
> standalone endpoint — UBL generation is the result of the spreadsheet
> upload step itself, at `POST /api/convert`. Every format below is derived
> from *that* UBL XML, not from a second copy of the spreadsheet.

| Method | Endpoint | Converts |
|---|---|---|
| `POST` | `/api/convert` | Spreadsheet → UBL XML |
| `POST` | `/api/facturx/pdf` | UBL XML → Factur-X-style PDF/A-3 |
| `POST` | `/api/pdf/extract-xml` | PDF → extracted embedded XML |
| `POST` | `/api/xrechnung/generate` | UBL XML → XRechnung XML |
| `POST` | `/api/zugferd/generate` | UBL XML → ZUGFeRD PDF/A-3 |
| `POST` | `/api/cii/generate` | UBL XML → plain CII XML |
| `GET` | `/health` | Liveness check |

### Example — spreadsheet to UBL

```bash
curl -X POST http://localhost:3000/api/convert \
  -F "file=@invoice.xlsx"
```

```json
{
  "success": true,
  "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Invoice ...>...</Invoice>"
}
```

### Example — UBL to CII

```bash
curl -X POST http://localhost:3000/api/cii/generate \
  -H "Content-Type: application/json" \
  -d '{"xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>"}' \
  -o invoice.cii.xml
```

Response headers:

```
Content-Type: application/xml
Content-Disposition: attachment; filename="invoice.cii.xml"
```

### Example — UBL to ZUGFeRD PDF

```bash
curl -X POST http://localhost:3000/api/zugferd/generate \
  -H "Content-Type: application/json" \
  -d '{"xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>"}' \
  -o invoice.pdf
```

Response headers:

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="zugferd.pdf"
```

---

## Supported Invoice Formats

| Format | Syntax | Container | Typical use in EU e-invoicing |
|---|---|---|---|
| **UBL** (Universal Business Language) | XML, OASIS UBL 2.1 | Standalone XML | The de facto syntax for PEPPOL BIS Billing 3.0 — used across most EU cross-border B2G/B2B PEPPOL networks |
| **CII** (Cross Industry Invoice) | XML, UN/CEFACT | Standalone XML, or embedded in a PDF/A-3 | The alternative EN 16931 syntax binding; required inside ZUGFeRD/Factur-X PDFs |
| **XRechnung** | XML, CII syntax | Standalone XML | Mandatory format for invoicing German public-sector (B2G) buyers; validated by the KoSIT validator |
| **ZUGFeRD** (PDF/A-3 + XML) | CII XML embedded in a human-readable PDF | PDF/A-3 hybrid | The German hybrid invoice format for B2B/B2G exchange where a human-readable PDF is still required alongside machine-readable data — technically identical to Factur-X since ZUGFeRD 2.0 |

In short: send **UBL** or **CII** when a trading partner's system expects raw
XML over a network like PEPPOL; send **XRechnung** specifically for German
public-sector invoicing; send a **ZUGFeRD/Factur-X PDF** when the recipient
needs something a human can open and read *and* their accounting software
needs to parse automatically from the same file.

---

## Validation

Validation happens in two independent layers — see
[`docs/validation.md`](./docs/validation.md) for the complete picture:

1. **App-level EN 16931 business rules** — run on the internal invoice model
   immediately after spreadsheet mapping, before any XML is generated.
   Covers required fields (invoice ID, dates, currency, seller/buyer
   addresses), line-item sanity checks (non-zero quantity and price, valid
   tax category), and arithmetic reconciliation (line sums must match the
   invoice totals). See [`docs/errors.md`](./docs/errors.md) for the full
   rule table (`BR-02`, `BR-06`, `BR-12`, `BR-CO-15`, and more).
2. **Structural schema validation** — during CII/XRechnung/ZUGFeRD
   generation, the underlying `@e-invoice-eu/core` library runs its own JSON
   Schema validation (required fields, currency-code companions on every
   monetary value, correct array/tuple shapes) and rejects invalid input
   before producing any output.

Business-rule fixes for specific EN 16931 rules — including `BR-AE-02`,
`BR-S-02`, `BR-Z-02` (seller/buyer tax registration requirements) and
`BR-IC-12` (intra-community delivery country) — are documented with their
root causes and exact fixes in [`docs/errors.md`](./docs/errors.md).

**PDF/A-3 validation** is currently manual: this app does not run an
automated PDF/A conformance checker (such as veraPDF) against generated
PDFs. See [`docs/pdf-generation.md`](./docs/pdf-generation.md) for exactly
which PDF/A-3 structural elements each PDF generation path does and doesn't
produce.

**How errors reach the UI:** every failed request returns a structured JSON
error body (`{ success: false, message, errors? }`). Each Angular tab
component renders `errors[]` as a labelled list and any other failure as a
single error message, inside a red alert box — nothing fails silently.

---

## Screenshots

<!-- Add real screenshots here before publishing -->

![Convert to UBL tab](./docs/screenshots/convert-tab.png)

![XRechnung generation tab](./docs/screenshots/xrechnung-tab.png)

![ZUGFeRD PDF generation tab](./docs/screenshots/zugferd-tab.png)

![PDF XML extraction tab](./docs/screenshots/pdf-extract-tab.png)

---

## Documentation

Detailed reference documentation lives in [`/docs`](./docs):

| Document | Contents |
|---|---|
| [`architecture.md`](./docs/architecture.md) | Full system architecture, module breakdown, data-flow diagrams |
| [`api-endpoints.md`](./docs/api-endpoints.md) | Every backend endpoint, with request/response examples and error codes |
| [`errors.md`](./docs/errors.md) | UBL/CII/XRechnung/ZUGFeRD business rules, app-level errors, and how each is resolved |
| [`mapping.md`](./docs/mapping.md) | Spreadsheet-to-JSON mapping: cell coordinates, VAT categories, fallback logic |
| [`invoice-model.md`](./docs/invoice-model.md) | The internal `InvoiceData` JSON schema, field by field |
| [`validation.md`](./docs/validation.md) | How UBL, CII, XRechnung, ZUGFeRD, and PDF/A-3 validation work, and their limits |
| [`pdf-generation.md`](./docs/pdf-generation.md) | PDF/A-3 construction, XML embedding, metadata, ICC profiles, ZUGFeRD profile levels |
| [`faq.md`](./docs/faq.md) | Common questions and troubleshooting for validation and mapping issues |
| [`examples.md`](./docs/examples.md) | Full worked examples: JSON invoice, mapping config, UBL/CII XML, validator output |

---

## Contributing

Contributions are welcome. Before opening a pull request:

1. **Keep changes scoped.** This codebase deliberately keeps each e-invoicing
   format's generator self-contained (see
   [`docs/architecture.md`](./docs/architecture.md#42-the-ubl-reversal-pattern))
   — avoid introducing cross-imports between generator services unless
   you're deliberately refactoring that pattern as its own change.
2. **Don't modify `ubl.service.ts`'s existing business rules** without
   understanding their PEPPOL/EN 16931 justification — most lines are there
   to satisfy a specific `BR-*` rule, documented inline.
3. **Run both builds before submitting:**
   ```bash
   npm run build          # frontend
   cd backend && npm run build   # backend TypeScript check
   ```
4. **Update `/docs`** alongside any change to a generator, endpoint, or
   mapping — the docs are meant to describe the code as it actually behaves,
   not an aspirational version of it.
5. **Describe what you tested.** Since this app's PDF/A-3 and Schematron-level
   compliance isn't automatically verified by CI, note in your PR how you
   validated any change that touches XML or PDF generation (e.g. "ran output
   through the KoSIT validator" or "inspected the PDF catalog with pdf-lib").

Please open an issue to discuss significant changes (new format support, a
different validation engine, etc.) before investing time in an
implementation.

---

## License

No license has been chosen for this project yet. Until a `LICENSE` file is
added to the repository, all rights are reserved by the project's author(s),
and this code should not be assumed to be open source or redistributable.
Update this section and add a `LICENSE` file once a license (e.g. MIT,
Apache-2.0) has been decided on.
