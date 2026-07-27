# SpreadsheetApp — PDF/A-3 Generation

This app has **two independent PDF/A-3 generation implementations**. This
document explains both, since they differ meaningfully in completeness.

## 1. Why two implementations exist

`facturx.service.ts` (behind `POST /api/facturx/pdf`) was built first, using
`pdf-lib` directly, before it was confirmed that `@e-invoice-eu/core` (the
real `gflohr/e-invoice-eu` package) was available and usable in this project.
`zugferd.service.ts` (behind `POST /api/zugferd/generate`) was built once
that library was confirmed working, and delegates almost all of the PDF/A-3
construction to it. Both remain in the codebase; neither has been removed,
per this app's "don't modify existing generators" convention.

| | `/api/facturx/pdf` | `/api/zugferd/generate` |
|---|---|---|
| CII XML generation | Hand-rolled `xmlbuilder2` (`buildCiiXml`) | `@e-invoice-eu/core`, format `'ZUGFeRD-EN16931'` |
| Visual PDF page | Hand-drawn multi-section invoice layout (`drawInvoice`) | Compact single-page summary (`renderVisualPdf`) |
| Attachment relationship | `AFRelationship.Data` | `AFRelationship.Alternative` |
| Attachment filename | `factur-x.xml` | `factur-x.xml` (library's own naming — used even in "ZUGFeRD" mode, since ZUGFeRD ≥2.0 uses the same Factur-X container convention) |
| XMP metadata | Hand-built string template | Library-built (`addXmpMeta`/`addRdf`/`addFacturXStuff`, incl. proper PDF/A Extension Schema description) |
| ICC `OutputIntent` | Only if `backend/assets/sRGB.icc` exists on disk | Always — library bundles a real base64-encoded sRGB profile |
| PDF/A structure tagging | Not implemented | `StructTreeRoot` + `MarkInfo` (`setStructTreeRoot`, `setMarkInfo`) |
| Trailer ID | Default `pdf-lib` behaviour | SHA-512 hash of the invoice subject, set explicitly (`setTrailerInfoID`) |

## 2. Step-by-step: `facturx.service.ts` (hand-rolled)

```
UBL XML
   │  parseUblToInvoiceData()      — fast-xml-parser reversal
   ▼
InvoiceData
   │  buildCiiXml()                — xmlbuilder2, CII structure
   ▼
CII XML string
   │  buildFacturXPdf()
   │    1. PDFDocument.create()
   │    2. drawInvoice()           — pdf-lib drawText/drawRectangle/drawLine
   │    3. pdfDoc.attach(ciiXml, 'factur-x.xml', { afRelationship: Data })
   │    4. attachXmpMetadata()     — custom XMP string → Metadata stream
   │    5. attachOutputIntent()    — only if sRGB.icc present on disk
   ▼
PDF/A-3-style buffer
```

### Embedding the XML

`pdf-lib`'s `PDFDocument.attach()` handles the full PDF/A-3 "Associated
Files" wiring for you: it creates the `EmbeddedFile` stream, the `Filespec`
dictionary, adds the filename to `/Names/EmbeddedFiles`, and — critically —
adds the file's ref to the document catalog's `/AF` array (the array PDF/A-3
readers use to discover embedded files, per the PDF Association's AF
technical note). This app relies on that built-in behaviour rather than
constructing the `/AF` array by hand.

### Adding metadata

`attachXmpMetadata()` builds an XMP packet directly as a template string,
including:

- Dublin Core (`dc:title`, `dc:description`)
- Adobe PDF (`pdf:Producer`)
- XMP core (`xmp:CreatorTool`, `xmp:CreateDate`)
- `pdfaid:part` = `3`, `pdfaid:conformance` = `B`
- The Factur-X extension schema (`fx:` namespace,
  `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`):
  `fx:DocumentType`, `fx:DocumentFileName`, `fx:Version`, `fx:ConformanceLevel`

This string is registered as a raw PDF stream
(`pdfDoc.context.stream(xmp, {...})`) and set directly on the catalog's
`/Metadata` entry — bypassing `pdf-lib`'s higher-level metadata APIs, which
don't support arbitrary custom XMP.

### Adding the ICC profile

**This is the one incomplete piece of this path.** PDF/A-3 requires an
`OutputIntent` dictionary referencing an embedded ICC colour profile. There is
no way to fabricate a valid ICC profile file from code, so
`attachOutputIntent()`:

1. Checks whether `backend/assets/sRGB.icc` exists.
2. If yes: reads it, wraps it in a flate-compressed stream, and sets a
   `GTS_PDFA1` `OutputIntent` referencing it.
3. If no: logs a warning and returns without adding the entry. **The PDF is
   still valid PDF/A-3 in every other respect** — it just won't pass the
   colour-space portion of a strict PDF/A-3 conformance check.

To complete this, download a standard sRGB ICC profile (e.g. `sRGB2014.icc`
from [color.org](https://www.color.org/srgbprofiles.xalter)) and save it at
`backend/assets/sRGB.icc`.

## 3. Step-by-step: `zugferd.service.ts` (`@e-invoice-eu/core`)

```
UBL XML
   │  parseUblToInvoiceData()  — same reversal pattern, duplicated locally
   ▼
InvoiceData
   │  toEInvoiceEuInvoice()    — maps to @e-invoice-eu/core's `Invoice` JSON shape
   │  renderVisualPdf()        — pdf-lib, minimal one-page summary
   ▼
Invoice JSON + visual PDF buffer
   │  InvoiceService.generate(invoice, {
   │    format: 'ZUGFeRD-EN16931',
   │    lang: 'en',
   │    pdf: { buffer: visualPdf, filename, mimetype: 'application/pdf' }
   │  })
   ▼
PDF/A-3 buffer (fully built by the library)
```

Internally, `FormatFacturXService.generate()` (inside `@e-invoice-eu/core`):

1. `getInvoicePdf(options)` — returns `options.pdf.buffer` as the base visual
   PDF (this app always supplies one; the library can alternatively render a
   spreadsheet to PDF via a `libreOfficePath` + headless LibreOffice, which
   this app deliberately avoids depending on).
2. Loads that PDF with `pdf-lib`.
3. Generates the CII XML (`super.generate()`, i.e. `FormatCIIService`).
4. Attaches it as `factur-x.xml` with `AFRelationship.Alternative`
   (`attachFacturX`).
5. `createPDFA()` — builds the full XMP packet (Dublin Core, `pdf:`, `xmp:`,
   `pdfaid:`, PDF/A Extension Schema, and the `fx:` Factur-X fields),
   sets `/Author`, `/CreationDate`, `/Producer`, `/Keywords`
   (`['Invoice', 'Factur-X', 'ZUGFeRD']`), `/Title`, `/Subject`.
6. Sets the trailer `/ID` to a SHA-512 hash of the invoice subject line.
7. `setOutputIntent()` — decodes the library's **bundled, real** base64 sRGB
   ICC profile and sets a proper `GTS_PDFA1` OutputIntent. No external asset
   file is needed for this path.
8. `fixLinkAnnotations()`, `setMarkInfo()`, `setStructTreeRoot()` — PDF/A
   structural/accessibility requirements.

Why a visual PDF must be supplied at all: PDF/A-3/Factur-X/ZUGFeRD requires a
human-readable visual representation of the invoice *alongside* the embedded
machine-readable XML — a reader without e-invoicing support must still be
able to open the file and read the invoice. `renderVisualPdf()` draws a
compact summary (seller/buyer, line items, totals) directly with `pdf-lib`
rather than depending on LibreOffice being installed on the server.

## 4. ZUGFeRD profile levels

`@e-invoice-eu/core` supports the full set of ZUGFeRD/Factur-X conformance
levels, each a distinct registered format:

| Format string | `FormatFactoryService` class | Conformance level | Notes |
|---|---|---|---|
| `Factur-X-Minimum` | `FormatFacturXMinimumService` | MINIMUM | Header data only, no line items |
| `Factur-X-Basic WL` | `FormatFacturXBasicWLService` | BASIC WL | "Without Lines" |
| `Factur-X-Basic` | `FormatFacturXBasicService` | BASIC | |
| `Factur-X-EN16931` | `FormatFacturXEN16931Service` | EN 16931 | **Used by this app** (`'ZUGFeRD-EN16931'` normalises to this) |
| `Factur-X-Extended` | `FormatFacturXExtendedService` | EXTENDED | Superset of EN16931 |
| `Factur-X-XRechnung` | `FormatFacturXXRechnungService` | XRECHNUNG | XRechnung-in-a-PDF variant |

`zugferd.service.ts` always requests `'ZUGFeRD-EN16931'` — the profile level
that matches the semantic detail this app's `InvoiceData` model actually
carries (full line items, VAT breakdown, party detail). It is not
configurable from the UI; changing it means editing the `ZUGFERD_FORMAT`
constant in `zugferd.service.ts`.

## 5. Factur-X compatibility

**ZUGFeRD and Factur-X are the same technical standard since ZUGFeRD 2.0**
(both embed CII XML in a PDF/A-3, with the same profile-level naming). This
isn't a simplification made by this app — it's how `@e-invoice-eu/core`
itself treats it: its `FormatFactoryService.normalizeFormat()` contains the
literal line:

```js
format = format.replace(/^zugferd-/, 'factur-x-');
```

So requesting format `'ZUGFeRD-EN16931'` resolves to the exact same
`FormatFacturXEN16931Service` class a request for `'Factur-X-EN16931'` would
use. There is no separate ZUGFeRD-specific code path inside the library, and
no separate `@e-invoice-eu/zugferd` or `@e-invoice-eu/pdf` package exists —
both were confirmed absent from the npm registry during development.

A PDF produced by `POST /api/zugferd/generate` is therefore simultaneously a
valid Factur-X PDF and a valid ZUGFeRD 2.x PDF, and can be extracted back
into XML by `POST /api/pdf/extract-xml` (or by any third-party
ZUGFeRD/Factur-X-aware tool) identically either way.
