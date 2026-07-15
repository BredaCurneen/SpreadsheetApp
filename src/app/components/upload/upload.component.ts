import { Component, inject, signal, computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InvoiceService, ValidationError } from '../../services/invoice.service';

@Component({
  selector: 'app-upload',
  standalone: true,
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css',
})
export class UploadComponent {
  private invoiceService = inject(InvoiceService);

  selectedFile = signal<File | null>(null);
  isLoading = signal(false);
  xml = signal<string | null>(null);
  errors = signal<ValidationError[]>([]);
  warnings = signal<ValidationError[]>([]);
  errorMessage = signal<string | null>(null);

  readonly fatals = computed(() => this.errors().filter((e) => e.severity === 'fatal'));
  readonly hasResult = computed(() => !!this.xml() || this.errors().length > 0 || !!this.errorMessage());
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

    this.isLoading.set(true);
    this.clearResult();

    try {
      const result = await firstValueFrom(this.invoiceService.convert(file));
      if (result.xml) {
        this.xml.set(result.xml);
        this.warnings.set(result.warnings ?? []);
      } else {
        this.errors.set(result.errors ?? []);
        if (!result.errors?.length) {
          this.errorMessage.set(result.message ?? 'Conversion failed with no details.');
        }
      }
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Unexpected error.');
    } finally {
      this.isLoading.set(false);
    }
  }

  downloadXml(): void {
    const content = this.xml();
    if (!content) return;
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `invoice-${this.selectedFile()?.name?.replace(/\.[^.]+$/, '') ?? 'output'}.xml`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  copyXml(): void {
    const content = this.xml();
    if (content) navigator.clipboard.writeText(content);
  }

  private clearResult(): void {
    this.xml.set(null);
    this.errors.set([]);
    this.warnings.set([]);
    this.errorMessage.set(null);
  }
}
