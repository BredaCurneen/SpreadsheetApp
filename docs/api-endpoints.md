# SpreadsheetApp — API Endpoints

All endpoints are mounted under the `/api` prefix (see `backend/src/server.ts`).
The base URL used by the Angular frontend is `http://localhost:3000/api`
(`src/app/services/invoice.service.ts`).

> **Note on naming:** there is no `POST /api/ubl/generate` endpoint in this
> app. UBL generation happens as part of the spreadsheet-upload flow, at
> `POST /api/convert`. Every other endpoint below (`facturx`, `xrechnung`,
> `zugferd`, `cii`) takes that UBL XML as input rather than the spreadsheet
> or raw JSON — see [`architecture.md`](./architecture.md#42-the-ubl-reversal-pattern)
> for why.

---

## `POST /api/convert`

Converts an uploaded spreadsheet into UBL 2.1 XML (PEPPOL BIS 3).

**Request:** `multipart/form-data`, field name `file` — a `.xlsx`, `.ods`, or
`.csv` file (max 10 MB, enforced by `upload.middleware.ts`).

```bash
curl -X POST http://localhost:3000/api/convert \
  -F "file=@invoice.xlsx"
```

**Success response — `200 OK`:**

```json
{
  "success": true,
  "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Invoice xmlns=\"urn:oasis:names:specification:ubl:schema:xsd:Invoice-2\" ...>...</Invoice>",
  "warnings": [
    { "code": "BR-14", "severity": "warning", "message": "Seller VAT identifier is missing. Required unless exempt.", "location": "/Invoice/cac:AccountingSupplierParty" }
  ]
}
```

`warnings` is only present when non-fatal issues were found; it is omitted
entirely when there are none.

**Validation failure — `400 Bad Request`:**

```json
{
  "success": false,
  "message": "Invoice failed EN16931 validation.",
  "errors": [
    { "code": "BR-06", "severity": "fatal", "message": "Invoice shall have a Seller name.", "location": "/Invoice/cac:AccountingSupplierParty/cac:Party" }
  ]
}
```

**Other error responses:**

| Status | Cause |
|---|---|
| `400` | No file uploaded, unsupported file type/extension, sheet name not found |
| `413` | File exceeds the 10 MB limit |
| `500` | Unexpected parsing/generation failure |

---

## `POST /api/facturx/pdf`

Converts UBL XML into a Factur-X-style PDF/A-3, using the app's **hand-rolled**
generator (`facturx.service.ts` — see
[`architecture.md §4.3`](./architecture.md#43-two-independent-cii-code-paths-important)
for how this differs from the ZUGFeRD endpoint).

**Request:** `application/json`

```json
{ "xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>" }
```

```bash
curl -X POST http://localhost:3000/api/facturx/pdf \
  -H "Content-Type: application/json" \
  --data @request.json \
  -o invoice.pdf
```

**Success response — `200 OK`:**

| Header | Value |
|---|---|
| `Content-Type` | `application/pdf` |
| `Content-Disposition` | `attachment; filename="invoice.pdf"` |

Body: raw PDF bytes. The PDF embeds a CII XML file (`factur-x.xml`) with
`AFRelationship=Data`, custom XMP metadata, and (only if
`backend/assets/sRGB.icc` is present on disk) a PDF/A-3 `OutputIntent`.

**Error responses:**

| Status | Cause |
|---|---|
| `400` | Missing/non-string `xml` field, or the XML is not a valid UBL Invoice document |
| `500` | Unexpected PDF construction failure |

---

## `POST /api/pdf/extract-xml`

Extracts the embedded invoice XML attachment from a PDF (ZUGFeRD, Factur-X, or
any PDF/A-3 with an embedded XML attachment).

**Request:** `multipart/form-data`, field name `file` — a `.pdf` (max 20 MB).

```bash
curl -X POST http://localhost:3000/api/pdf/extract-xml \
  -F "file=@zugferd-invoice.pdf;type=application/pdf"
```

**Success response — `200 OK`:**

| Header | Value |
|---|---|
| `Content-Type` | `application/xml` |

Body: the raw extracted XML text (CII or UBL, whatever was embedded).

**Error responses:**

| Status | Cause |
|---|---|
| `400` | No file uploaded, wrong MIME/extension, PDF has no embedded attachments, or none of the attachments look like XML |
| `500` | Unexpected PDF parsing failure |

---

## `POST /api/xrechnung/generate`

Converts UBL XML into XRechnung XML (EN16931, **CII syntax**), via the real
`@e-invoice-eu/core` library with format `'XRECHNUNG-CII'`.

**Request:** `application/json`

```json
{ "xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>" }
```

**Success response — `200 OK`:**

| Header | Value |
|---|---|
| `Content-Type` | `application/xml` |

Body: XRechnung XML. `GuidelineSpecifiedDocumentContextParameter` resolves to
`urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`.

```bash
curl -X POST http://localhost:3000/api/xrechnung/generate \
  -H "Content-Type: application/json" \
  --data @request.json
```

**Error responses:**

| Status | Cause |
|---|---|
| `400` | Missing/non-string `xml`, invalid UBL, no invoice lines, or an `@e-invoice-eu/core` ajv schema/generation error (message passed through) |
| `500` | Unexpected failure |

---

## `POST /api/zugferd/generate`

Converts UBL XML into a **ZUGFeRD PDF/A-3** (EN16931 profile), via the real
`@e-invoice-eu/core` library with format `'ZUGFeRD-EN16931'` (internally
normalised to `'factur-x-en16931'` — ZUGFeRD ≥2.0 and Factur-X are the same
technical standard).

**Request:** `application/json`

```json
{ "xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>" }
```

```bash
curl -X POST http://localhost:3000/api/zugferd/generate \
  -H "Content-Type: application/json" \
  --data @request.json \
  -o zugferd.pdf
```

**Success response — `200 OK`:**

| Header | Value |
|---|---|
| `Content-Type` | `application/pdf` |
| `Content-Disposition` | `attachment; filename="zugferd.pdf"` |

Body: raw PDF/A-3 bytes. Embeds `factur-x.xml` with `AFRelationship=Alternative`,
a real bundled sRGB `OutputIntent`, `StructTreeRoot`/`MarkInfo` PDF/A tagging,
and full `fx:` XMP metadata — all handled internally by `@e-invoice-eu/core`.

**Error responses:**

| Status | Cause |
|---|---|
| `400` | Missing/non-string `xml`, invalid UBL, no invoice lines, or a library generation error |
| `500` | Unexpected failure |

---

## `POST /api/cii/generate`

Converts UBL XML into plain CII XML (EN16931, no XRechnung/Factur-X-specific
profile), via `@e-invoice-eu/core` with format `'CII'`.

**Request:** `application/json`

```json
{ "xml": "<Invoice xmlns=\"urn:oasis:...\">...</Invoice>" }
```

```bash
curl -X POST http://localhost:3000/api/cii/generate \
  -H "Content-Type: application/json" \
  --data @request.json \
  -o invoice.cii.xml
```

**Success response — `200 OK`:**

| Header | Value |
|---|---|
| `Content-Type` | `application/xml` |
| `Content-Disposition` | `attachment; filename="invoice.cii.xml"` |

Body: CII XML. `GuidelineSpecifiedDocumentContextParameter` resolves to plain
`urn:cen.eu:en16931:2017` (no XRechnung/Factur-X URN suffix).

**Error responses:**

| Status | Cause |
|---|---|
| `400` | Missing/non-string `xml`, invalid UBL, no invoice lines, or a library generation error |
| `500` | Unexpected failure |

---

## `GET /health`

Liveness check, defined inline in `server.ts`.

**Response — `200 OK`:**

```json
{ "status": "ok" }
```

---

## Error envelope shape

Every JSON error response (from every endpoint above) follows this shape,
produced by `middleware/error.middleware.ts`:

```ts
interface ErrorResponse {
  success: false;
  message: string;
  errors?: ValidationError[]; // only on POST /api/convert, EN16931 validation failures
  details?: unknown;          // only for 5xx errors, omitted from client-facing message
}
```

Status code resolution: each thrown `Error` may carry a `statusCode` property
(the `AppError` interface). If present, that status is used (e.g. `400` for
a bad-request-style failure raised inside a service); otherwise the handler
defaults to `500` and hides the real error message from the client (logging
it server-side via `winston` instead).
