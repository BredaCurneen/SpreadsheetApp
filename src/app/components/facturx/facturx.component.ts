import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvoiceService, ValidationError } from '../../services/invoice.service';

@Component({
  selector: 'app-facturx',
  standalone: true,
  templateUrl: './facturx.component.html',
  styleUrl: './facturx.component.css',
})
export class FacturxComponent {
  private invoiceService = inject(InvoiceService);

  selectedFile = signal<File | null>(null);
  isConverting = signal(false);
  isGeneratingPdf = signal(false);
  xml = signal<string | null>(null);
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
        this.xml.set(result.xml);
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

  async generateFacturXPdf(): Promise<void> {
    const xml = this.xml();
    if (!xml) return;

    this.isGeneratingPdf.set(true);
    this.errorMessage.set(null);

    try {
      const blob = await firstValueFrom(this.invoiceService.generateFacturXPdf(xml));
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `invoice-${this.selectedFile()?.name?.replace(/\.[^.]+$/, '') ?? 'facturx'}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error generating the PDF.');
    } finally {
      this.isGeneratingPdf.set(false);
    }
  }

  private clearResult(): void {
    this.xml.set(null);
    this.errors.set([]);
    this.errorMessage.set(null);
  }
}
