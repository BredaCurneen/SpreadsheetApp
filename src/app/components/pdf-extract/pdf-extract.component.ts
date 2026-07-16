import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvoiceService } from '../../services/invoice.service';

@Component({
  selector: 'app-pdf-extract',
  standalone: true,
  templateUrl: './pdf-extract.component.html',
  styleUrl: './pdf-extract.component.css',
})
export class PdfExtractComponent {
  private invoiceService = inject(InvoiceService);

  selectedFile = signal<File | null>(null);
  isExtracting = signal(false);
  xml = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  readonly acceptedTypes = '.pdf';

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

  async extractXml(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.isExtracting.set(true);
    this.clearResult();

    try {
      const xml = await firstValueFrom(this.invoiceService.extractXmlFromPdf(file));
      this.xml.set(xml);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error extracting the XML.');
    } finally {
      this.isExtracting.set(false);
    }
  }

  downloadXml(): void {
    const content = this.xml();
    if (!content) return;
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.selectedFile()?.name?.replace(/\.[^.]+$/, '') ?? 'extracted'}.xml`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  copyXml(): void {
    const content = this.xml();
    if (content) navigator.clipboard.writeText(content);
  }

  private clearResult(): void {
    this.xml.set(null);
    this.errorMessage.set(null);
  }
}
