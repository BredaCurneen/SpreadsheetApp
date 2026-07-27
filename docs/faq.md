# SpreadsheetApp — FAQ & Troubleshooting

## General

### What formats can this app produce from one spreadsheet?

Upload once on any tab (each tab has its own upload + "Convert to XML" step),
and from the resulting UBL XML you can generate: a Factur-X-style PDF/A-3, a
ZUGFeRD PDF/A-3, plain CII XML, or XRechnung XML. You can also go the other
direction — upload any ZUGFeRD/Factur-X PDF and extract its embedded XML.

### What's the difference between the "Factur-X PDF" tab and the "ZUGFeRD PDF" tab?

They use two different code paths that both produce a PDF/A-3 with embedded
CII XML, but with different levels of completeness:

- **Factur-X PDF** (`/api/facturx/pdf`) — a hand-rolled generator built
  directly with `pdf-lib`. It works, but its PDF/A-3 `OutputIntent` (the ICC
  colour profile) is only included if you've manually placed a real sRGB ICC
  file at `backend/assets/sRGB.icc` — otherwise it's silently skipped.
- **ZUGFeRD PDF** (`/api/zugferd/generate`) — uses the real
  `@e-invoice-eu/core` library, which bundles its own real ICC profile and
  adds proper PDF/A structure tagging (`StructTreeRoot`/`MarkInfo`). This
  path is more complete.

If you need the most standards-complete PDF/A-3, prefer the ZUGFeRD tab.

### Are XRechnung and ZUGFeRD really the same as Factur-X?

XRechnung and Factur-X/ZUGFeRD are all EN16931-conformant profiles, but they
are **not** the same document type:

- **Factur-X / ZUGFeRD (≥2.0)** — a PDF/A-3 *file* with CII XML embedded
  inside it. Same technical standard, different national branding (France /
  Germany).
- **XRechnung** — a standalone XML document (this app generates it in CII
  syntax; the standard also allows a UBL syntax binding), with no PDF at all.
- **Plain CII** — the raw UN/CEFACT XML syntax, without any
  Factur-X/XRechnung-specific customization ID.

Don't expect an XRechnung `.xml` file to open in a PDF viewer, or a ZUGFeRD
PDF's embedded XML to have the exact same `GuidelineSpecifiedDocumentContextParameter`
as a file from the CII tab — they're deliberately different URNs (see
[`examples.md`](./examples.md)).

## Why does my XML fail validation?

### "Reverse charge lines (BT-151 = AE) require Seller VAT ID..." (BR-AE-02) / similar BR-S-02 / BR-Z-02

These were real bugs found and fixed during development — if you're seeing
them on a fresh copy of this app, you're likely hitting an edge case not yet
covered. Concretely, they mean the Seller (and, for `AE`, also the Buyer)
has no VAT number reaching the generator. Check:

1. Does your spreadsheet actually have a value in the seller/buyer VAT
   number cell? (See [`mapping.md`](./mapping.md) for the exact cell
   coordinates in the default mapping.)
2. Is `mapping.service.ts` reading the right cell — did you customize
   `default-invoice-mapping.json` and get a coordinate wrong?

If the VAT number really is absent, this app now falls back to a literal
`"NA"` placeholder rather than omitting the element entirely (with a
`logger.warn()` in the backend console) — so the *specific* BR-AE-02/BR-S-02/
BR-Z-02 errors described above should no longer occur, but `"NA"` obviously
isn't a real VAT number and any downstream validator that checks the VAT
number's *format* (not just its presence) will still complain. Fix it at the
source: fill in the spreadsheet's VAT number cell.

### "Deliver-to country code (BT-80) shall not be blank" (BR-IC-12)

Only relevant when a line's VAT category is `K` (intra-community supply).
Fixed the same way — the generator now always emits a delivery country for
`K`-category invoices, falling back through: spreadsheet's delivery-country
column → buyer's country (UBL) or seller's country (CII/XRechnung/ZUGFeRD) →
literal `"IE"`. If you still see this, check whether your spreadsheet
actually marks any line with tax category `K` when it shouldn't, or vice
versa.

### "must have property cbc:TaxableAmount@currencyID..." (or similar `@currencyID` errors)

This is an `@e-invoice-eu/core` ajv schema error, not an EN16931 business
rule — it means a monetary field is missing its sibling currency-code
attribute. If you're only using this app's built-in tabs, you shouldn't hit
this (every amount field the app builds already includes the `@currencyID`
sibling). If you've modified `xrechnung.service.ts`/`zugferd.service.ts`/
`cii.service.ts`'s mapping code and added a new monetary field, remember to
add its `@currencyID` companion too.

### My generated UBL/CII XML "looks fine" but a KoSIT/Chorus Pro/veraPDF validator still flags it

This app runs its own subset of EN16931 checks (see
[`validation.md`](./validation.md)), plus whatever ajv schema
`@e-invoice-eu/core` enforces — it does **not** run a full Schematron rule
engine or an external validator automatically. Some official EN16931/CIUS
rules aren't checked at all by this app. Treat this app's "no errors" as
"passed our checks," not "certified compliant" — always run output through
the real target validator before submitting it anywhere that legally
requires compliance.

## Why does PDF/A-3 fail (veraPDF or similar)?

Most likely cause: the **Factur-X tab's** hand-rolled PDF generator is
missing its ICC `OutputIntent` because `backend/assets/sRGB.icc` doesn't
exist on your server. Check the backend logs for:

```
No ICC profile found at .../backend/assets/sRGB.icc — generated PDF will omit the PDF/A-3 OutputIntent.
```

Fix: download a real sRGB ICC profile (e.g. `sRGB2014.icc` from
[color.org](https://www.color.org/srgbprofiles.xalter)) and save it at that
exact path. Alternatively, use the **ZUGFeRD tab** instead — its underlying
`@e-invoice-eu/core` library bundles a real ICC profile itself, so this
failure mode doesn't apply there.

If neither path's output passes a strict conformance checker, remember:
neither has been run through veraPDF or certified — see
[`pdf-generation.md`](./pdf-generation.md) for the exact list of what each
path does and doesn't implement (`StructTreeRoot`/`MarkInfo` tagging in
particular is only implemented in the ZUGFeRD path).

## How do I fix mapping issues?

1. Open `backend/mappings/default-invoice-mapping.json` and compare its
   `{ col, row }` coordinates against your actual spreadsheet — remember
   these are **0-based**, so column `O` is `14`, not `15`, and row `1` is
   `0`.
2. Use [`mapping.md`](./mapping.md)'s column-letter/index table to convert
   between spreadsheet notation and the JSON coordinates.
3. Check `lineItemsStartRow` — line extraction stops at the **first row with
   a blank description cell**, so a stray blank row inside your line-items
   block will silently truncate the invoice rather than error.
4. If a tax category column value isn't one of `S`, `Z`, `E`, `AE`, `K`, `O`
   (case-sensitive), it's silently ignored and the category is instead
   *derived* from the VAT rate (`> 0% → S`, `else → Z`) — this can produce a
   different category than you intended without raising any warning.
5. Dates: anything not already `YYYY-MM-DD` is passed through
   `normaliseDate()` (handles `DD/MM/YYYY`-ish strings and native
   Excel/ODS date cells). If a date still looks wrong in the output, check
   the raw cell value/format in the spreadsheet itself first.

## Why do I get a 413 error uploading my spreadsheet?

Spreadsheet uploads are capped at 10 MB (`upload.middleware.ts`). PDF
uploads (for the extract-XML tab) are capped at 20 MB
(`pdf-extract.route.ts`'s local multer instance). Split or compress the file
if you hit this.

## Why does the "Extract XML from PDF" tab say "This PDF has no embedded file attachments"?

The uploaded PDF has no `/Names/EmbeddedFiles` entries at all — it's a
regular PDF, not a ZUGFeRD/Factur-X (or otherwise XML-embedding PDF/A-3)
file. This tab can only extract XML that's actually embedded as a file
attachment inside the PDF; it can't infer invoice data from the PDF's visual
content.

## Why does it say "No XML attachment found among this PDF's embedded files"?

The PDF has embedded attachments, but none of them are named
`factur-x.xml`, `zugferd-invoice.xml`, `xrechnung.xml`, or end in `.xml`.
Check what's actually attached to the PDF (e.g. open it in Adobe Acrobat's
Attachments panel) — it may have a differently-named XML attachment that
this app's `pickXmlAttachment()` doesn't yet recognise by name (it does fall
back to *any* `.xml`-extension attachment, so this only happens if the
attachment has a non-`.xml` filename or isn't XML at all).
