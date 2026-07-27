# SpreadsheetApp — Worked Examples

All examples below use the same sample invoice (the fixture used throughout
development): Omni Consulting Ltd (IE) billing Acme Retail GmbH (DE) for
consulting services, standard-rated at 23%.

## 1. Example JSON invoice (`InvoiceData`)

This is the app's internal model — see [`invoice-model.md`](./invoice-model.md)
for the full schema.

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

## 2. Example `mapping.json` (actual `default-invoice-mapping.json`)

```json
{
  "sheet": "Invoice",
  "fields": {
    "invoiceId":            { "col": 14, "row": 11 },
    "issueDate":            { "col":  8, "row":  5 },
    "dueDate":              { "col":  8, "row": 11 },
    "currencyCode":         { "col": 14, "row": 10 },
    "typeCode":             { "col": 12, "row": 18 },
    "buyerReference":       { "col":  8, "row": 10 },
    "precedingInvoiceId":   { "col": 14, "row": 12 },
    "precedingInvoiceDate": { "col": 15, "row": 12 },

    "invoicePeriodStart":   { "col":  8, "row":  6 },
    "invoicePeriodEnd":     { "col":  8, "row":  7 },

    "delivery": {
      "actualDeliveryDate": { "col":  8, "row":  7 }
    },

    "seller": {
      "name":             { "col": 14, "row":  0 },
      "street":           { "col": 14, "row":  1 },
      "postalCode":       { "col": 14, "row":  2 },
      "city":             { "col": 14, "row":  3 },
      "country":          { "col": 14, "row":  4 },
      "vatNumber":        { "col": 14, "row":  5 },
      "registration":     { "col": 14, "row":  0 },
      "contactName":      { "col":  8, "row": 13 },
      "contactEmail":     { "col":  8, "row": 14 },
      "contactPhone":     { "col":  8, "row": 15 },
      "endpointSchemeId": "9930"
    },

    "buyer": {
      "name":             { "col":  0, "row":  6 },
      "street":           { "col": 14, "row":  6 },
      "postalCode":       { "col": 14, "row":  7 },
      "city":             { "col": 14, "row":  8 },
      "country":          { "col": 14, "row":  9 },
      "vatNumber":        { "col":  8, "row":  8 },
      "registration":     { "col":  0, "row":  0 },
      "endpointSchemeId": "9930"
    },

    "payment": {
      "iban":         { "col": 14, "row": 14 },
      "bic":          { "col": 14, "row": 15 },
      "paymentTerms": { "col":  0, "row": 46 }
    },

    "lineItemsStartRow": 22,
    "lineItemColumns": {
      "description": 1,
      "quantity":    3,
      "unit":       12,
      "unitPrice":   5,
      "vatRate":    14,
      "netAmount":   9,
      "taxCategory": 13
    }
  }
}
```

## 3. Example UBL XML (`POST /api/convert` response, structure per `ubl.service.ts`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>INV-2026-001</cbc:ID>
  <cbc:IssueDate>2026-07-10</cbc:IssueDate>
  <cbc:DueDate>2026-08-09</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:Note>Thank you for your business.</cbc:Note>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>PO-4471</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="9930">IE1234567T</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Omni Consulting Ltd</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>12 Harbour Road</cbc:StreetName>
        <cbc:CityName>Dublin</cbc:CityName>
        <cbc:PostalZone>D02 XY45</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>IE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>IE1234567T</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Omni Consulting Ltd</cbc:RegistrationName>
        <cbc:CompanyID>IE1234567T</cbc:CompanyID>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>Sarah Byrne</cbc:Name>
        <cbc:Telephone>+353 1 234 5678</cbc:Telephone>
        <cbc:ElectronicMail>sarah@omni.ie</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="9930">DE987654321</cbc:EndpointID>
      <cac:PartyName><cbc:Name>Acme Retail GmbH</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Hauptstrasse 5</cbc:StreetName>
        <cbc:CityName>Berlin</cbc:CityName>
        <cbc:PostalZone>10115</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE987654321</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Acme Retail GmbH</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>IE29AIBK93115212345678</cbc:ID>
      <cac:FinancialInstitutionBranch><cbc:ID>AIBKIE2D</cbc:ID></cac:FinancialInstitutionBranch>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>Net 30 days</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">713.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">3100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">713.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>23</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">3100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">3100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">3813.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">3813.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1500.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>Consulting services — Q3 roadmap</cbc:Description>
      <cbc:Name>Consulting services — Q3 roadmap</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>23</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">150.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="DAY">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1600.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>On-site workshop delivery</cbc:Description>
      <cbc:Name>On-site workshop delivery</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>23</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">800.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>
```

## 4. Example CII XML (`POST /api/cii/generate` response, real output confirmed via `@e-invoice-eu/core`)

```xml
<?xml version="1.0" encoding="utf-8"?>
<rsm:CrossIndustryInvoice
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100 ../schema/D16B%20SCRDM%20(Subset)/uncoupled%20clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">
	<rsm:ExchangedDocumentContext>
		<ram:BusinessProcessSpecifiedDocumentContextParameter>
			<ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
		</ram:BusinessProcessSpecifiedDocumentContextParameter>
		<ram:GuidelineSpecifiedDocumentContextParameter>
			<ram:ID>urn:cen.eu:en16931:2017</ram:ID>
		</ram:GuidelineSpecifiedDocumentContextParameter>
	</rsm:ExchangedDocumentContext>
	<rsm:ExchangedDocument>
		<ram:ID>INV-2026-001</ram:ID>
		<ram:TypeCode>380</ram:TypeCode>
		<ram:IssueDateTime>
			<udt:DateTimeString format="102">20260710</udt:DateTimeString>
		</ram:IssueDateTime>
		<ram:IncludedNote>
			<ram:Content>Thank you for your business.</ram:Content>
		</ram:IncludedNote>
	</rsm:ExchangedDocument>
	<rsm:SupplyChainTradeTransaction>
		<ram:IncludedSupplyChainTradeLineItem>
			<ram:AssociatedDocumentLineDocument>
				<ram:LineID>1</ram:LineID>
			</ram:AssociatedDocumentLineDocument>
			<ram:SpecifiedTradeProduct>
				<ram:Name>Consulting services — Q3 roadmap</ram:Name>
			</ram:SpecifiedTradeProduct>
			<ram:SpecifiedLineTradeAgreement>
				<ram:NetPriceProductTradePrice>
					<ram:ChargeAmount>150.00</ram:ChargeAmount>
				</ram:NetPriceProductTradePrice>
			</ram:SpecifiedLineTradeAgreement>
			<ram:SpecifiedLineTradeDelivery>
				<ram:BilledQuantity unitCode="HUR">10</ram:BilledQuantity>
			</ram:SpecifiedLineTradeDelivery>
			<ram:SpecifiedLineTradeSettlement>
				<ram:ApplicableTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>S</ram:CategoryCode>
					<ram:RateApplicablePercent>23</ram:RateApplicablePercent>
				</ram:ApplicableTradeTax>
				<ram:SpecifiedTradeSettlementLineMonetarySummation>
					<ram:LineTotalAmount>1500.00</ram:LineTotalAmount>
				</ram:SpecifiedTradeSettlementLineMonetarySummation>
			</ram:SpecifiedLineTradeSettlement>
		</ram:IncludedSupplyChainTradeLineItem>
		<ram:ApplicableHeaderTradeAgreement>
			<ram:SellerTradeParty>
				<ram:Name>Omni Consulting Ltd</ram:Name>
				<ram:SpecifiedTaxRegistration>
					<ram:ID schemeID="VA">IE1234567T</ram:ID>
				</ram:SpecifiedTaxRegistration>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>D02 XY45</ram:PostcodeCode>
					<ram:LineOne>12 Harbour Road</ram:LineOne>
					<ram:CityName>Dublin</ram:CityName>
					<ram:CountryID>IE</ram:CountryID>
				</ram:PostalTradeAddress>
			</ram:SellerTradeParty>
			<ram:BuyerTradeParty>
				<ram:Name>Acme Retail GmbH</ram:Name>
				<ram:SpecifiedTaxRegistration>
					<ram:ID schemeID="VA">DE987654321</ram:ID>
				</ram:SpecifiedTaxRegistration>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>10115</ram:PostcodeCode>
					<ram:LineOne>Hauptstrasse 5</ram:LineOne>
					<ram:CityName>Berlin</ram:CityName>
					<ram:CountryID>DE</ram:CountryID>
				</ram:PostalTradeAddress>
			</ram:BuyerTradeParty>
		</ram:ApplicableHeaderTradeAgreement>
		<ram:ApplicableHeaderTradeSettlement>
			<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
			<ram:ApplicableTradeTax>
				<ram:CalculatedAmount>713.00</ram:CalculatedAmount>
				<ram:TypeCode>VAT</ram:TypeCode>
				<ram:BasisAmount>3100.00</ram:BasisAmount>
				<ram:CategoryCode>S</ram:CategoryCode>
				<ram:RateApplicablePercent>23</ram:RateApplicablePercent>
			</ram:ApplicableTradeTax>
			<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
				<ram:LineTotalAmount>3100.00</ram:LineTotalAmount>
				<ram:TaxBasisTotalAmount>3100.00</ram:TaxBasisTotalAmount>
				<ram:TaxTotalAmount currencyID="EUR">713.00</ram:TaxTotalAmount>
				<ram:GrandTotalAmount>3813.00</ram:GrandTotalAmount>
				<ram:DuePayableAmount>3813.00</ram:DuePayableAmount>
			</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
		</ram:ApplicableHeaderTradeSettlement>
	</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
```

Note: `GuidelineSpecifiedDocumentContextParameter` is plain
`urn:cen.eu:en16931:2017` here (from `/api/cii/generate`). The XRechnung
endpoint (`/api/xrechnung/generate`) produces the same overall shape but with
`urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`
instead — that URN is the only structural difference between the two.

## 5. Example ZUGFeRD PDF metadata

`POST /api/zugferd/generate` produces a PDF whose catalog contains (verified
directly with `pdf-lib` during development):

| Property | Value |
|---|---|
| `/Title` | `Omni Consulting Ltd: Invoice INV-2026-001` |
| `/Author` | `Omni Consulting Ltd` |
| `/Producer` | `e-invoice-eu - https://gflohr.github.io/e-invoice-eu` |
| `/Keywords` | `Invoice`, `Factur-X`, `ZUGFeRD` |
| `/AF[0]/F` | `factur-x.xml` |
| `/AF[0]/AFRelationship` | `Alternative` |
| `/OutputIntents[0]/S` | `GTS_PDFA1` |
| `/OutputIntents[0]/OutputConditionIdentifier` | `sRGB` |
| `/StructTreeRoot` | present (`{ Type: StructTreeRoot }`) |
| `/MarkInfo` | present (`{ Marked: true }`) |

The embedded XMP packet (representative structure — the library builds this
programmatically, field-by-field, rather than from a static template) looks
like:

```xml
<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
      <dc:title>Invoice INV-2026-001 dated 2026-07-10 issued by Omni Consulting Ltd</dc:title>
      <pdf:Producer>e-invoice-eu - https://gflohr.github.io/e-invoice-eu</pdf:Producer>
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
```

## 6. Example validator output (`POST /api/convert`, `400`)

Given a spreadsheet with a missing seller name and a line whose unit price is
zero:

```json
{
  "success": false,
  "message": "Invoice failed EN16931 validation.",
  "errors": [
    {
      "code": "BR-06",
      "severity": "fatal",
      "message": "Invoice shall have a Seller name.",
      "location": "/Invoice/cac:AccountingSupplierParty/cac:Party"
    },
    {
      "code": "BR-26",
      "severity": "fatal",
      "message": "Line 1: item net price shall be greater than zero.",
      "location": "/Invoice/cac:InvoiceLine[1]"
    },
    {
      "code": "BR-14",
      "severity": "warning",
      "message": "Seller VAT identifier is missing. Required unless exempt.",
      "location": "/Invoice/cac:AccountingSupplierParty"
    }
  ]
}
```

A request with only `warning`-severity issues instead succeeds, with the
warnings surfaced alongside the XML:

```json
{
  "success": true,
  "xml": "<?xml version=\"1.0\" ...?>...</Invoice>",
  "warnings": [
    {
      "code": "BR-14",
      "severity": "warning",
      "message": "Seller VAT identifier is missing. Required unless exempt.",
      "location": "/Invoice/cac:AccountingSupplierParty"
    }
  ]
}
```
