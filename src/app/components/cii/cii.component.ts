import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvoiceService, ValidationError } from '../../services/invoice.service';

@Component({
  selector: 'app-cii',
  standalone: true,
  templateUrl: './cii.component.html',
  styleUrl: './cii.component.css',
})
export class CiiComponent {
  private invoiceService = inject(InvoiceService);

  selectedFile = signal<File | null>(null);
  isConverting = signal(false);
  isGenerating = signal(false);
  ublXml = signal<string | null>(null);
  ciiXml = signal<string | null>(null);
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

  async generateCiiXml(): Promise<void> {
    const ublXml = this.ublXml();
    if (!ublXml) return;

    this.isGenerating.set(true);
    this.errorMessage.set(null);

    try {
      const xml = await firstValueFrom(this.invoiceService.generateCiiXml(ublXml));
      this.ciiXml.set(xml);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error generating CII XML.');
    } finally {
      this.isGenerating.set(false);
    }
  }

  downloadXml(): void {
    const content = this.ciiXml();
    if (!content) return;
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'invoice.cii.xml';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  copyXml(): void {
    const content = this.ciiXml();
    if (content) navigator.clipboard.writeText(content);
  }

  private clearResult(): void {
    this.ublXml.set(null);
    this.ciiXml.set(null);
    this.errors.set([]);
    this.errorMessage.set(null);
  }
}
