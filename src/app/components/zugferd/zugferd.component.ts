import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvoiceService, ValidationError } from '../../services/invoice.service';

@Component({
  selector: 'app-zugferd',
  standalone: true,
  templateUrl: './zugferd.component.html',
  styleUrl: './zugferd.component.css',
})
export class ZugferdComponent {
  private invoiceService = inject(InvoiceService);

  selectedFile = signal<File | null>(null);
  isConverting = signal(false);
  isGenerating = signal(false);
  ublXml = signal<string | null>(null);
  pdfBlob = signal<Blob | null>(null);
  embeddedXml = signal<string | null>(null);
  errors = signal<ValidationError[]>([]);
  errorMessage = signal<string | null>(null);

  readonly acceptedTypes = '.xlsx,.ods,.csv';

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.clearResult();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files[0] ?? null;
    if (file) {
      this.selectedFile.set(file);
      this.clearResult();
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async convert(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.isConverting.set(true);
    this.clearResult();

    try {
      const result = await firstValueFrom(this.invoiceService.convert(file));
      if (result.xml) {
        this.ublXml.set(result.xml);
      } else {
        this.errors.set(result.errors ?? []);
        if (!result.errors?.length) {
          this.errorMessage.set(result.message ?? 'Conversion failed with no details.');
        }
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      this.isConverting.set(false);
    }
  }

  async generateZugferdPdf(): Promise<void> {
    const ublXml = this.ublXml();
    if (!ublXml) return;

    this.isGenerating.set(true);
    this.errorMessage.set(null);
    this.pdfBlob.set(null);
    this.embeddedXml.set(null);

    try {
      const blob = await firstValueFrom(this.invoiceService.generateZugferdPdf(ublXml));
      this.pdfBlob.set(blob);

      // Read back the actual embedded CII XML from the generated PDF for an accurate preview.
      const pdfFile = new File([blob], 'zugferd.pdf', { type: 'application/pdf' });
      const embedded = await firstValueFrom(this.invoiceService.extractXmlFromPdf(pdfFile));
      this.embeddedXml.set(embedded);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error generating the ZUGFeRD PDF.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  downloadPdf(): void {
    const blob = this.pdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zugferd-${this.selectedFile()?.name?.replace(/\.[^.]+$/, '') ?? 'invoice'}.pdf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  copyEmbeddedXml(): void {
    const content = this.embeddedXml();
    if (content) navigator.clipboard.writeText(content);
  }

  downloadXml(): void {
    const content = this.embeddedXml();
    if (!content) return;
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'invoice.xml';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private clearResult(): void {
    this.ublXml.set(null);
    this.pdfBlob.set(null);
    this.embeddedXml.set(null);
    this.errors.set([]);
    this.errorMessage.set(null);
  }
}
