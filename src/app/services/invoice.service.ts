import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

export interface ValidationError {
  code: string;
  severity: 'fatal' | 'warning';
  message: string;
  location?: string;
}

export interface ConversionResponse {
  success: boolean;
  xml?: string;
  errors?: ValidationError[];
  warnings?: ValidationError[];
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class InvoiceService {
  private http = inject(HttpClient);
  private readonly apiBase = 'http://localhost:3000/api';

  convert(file: File): Observable<ConversionResponse> {
    const form = new FormData();
    form.append('file', file, file.name);

    return this.http.post<ConversionResponse>(`${this.apiBase}/convert`, form).pipe(
      catchError((err: HttpErrorResponse) => {
        // 400 responses carry structured validation errors — normalise them
        if (err.status === 400 && err.error) {
          return of(err.error as ConversionResponse);
        }
        const message =
          err.error?.message ?? err.message ?? `Server error (HTTP ${err.status})`;
        return throwError(() => new Error(message));
      }),
    );
  }

  generateFacturXPdf(xml: string): Observable<Blob> {
    return this.http
      .post(`${this.apiBase}/facturx/pdf`, { xml }, { responseType: 'blob' })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // With responseType 'blob', JSON error bodies also arrive as a Blob — read it back out.
          if (err.error instanceof Blob && err.error.type.includes('json')) {
            return from(err.error.text()).pipe(
              switchMap((text) => {
                const message = JSON.parse(text)?.message ?? `Server error (HTTP ${err.status})`;
                return throwError(() => new Error(message));
              }),
            );
          }
          const message = err.message ?? `Server error (HTTP ${err.status})`;
          return throwError(() => new Error(message));
        }),
      );
  }

  extractXmlFromPdf(file: File): Observable<string> {
    const form = new FormData();
    form.append('file', file, file.name);

    return this.http
      .post(`${this.apiBase}/pdf/extract-xml`, form, { responseType: 'text' })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // With responseType 'text', JSON error bodies arrive as a raw string — parse it back out.
          let message = err.message ?? `Server error (HTTP ${err.status})`;
          if (typeof err.error === 'string') {
            try {
              message = JSON.parse(err.error)?.message ?? message;
            } catch {
              // err.error wasn't JSON — fall back to the default message above.
            }
          }
          return throwError(() => new Error(message));
        }),
      );
  }

  generateXRechnung(xml: string): Observable<string> {
    return this.http
      .post(`${this.apiBase}/xrechnung/generate`, { xml }, { responseType: 'text' })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // With responseType 'text', JSON error bodies arrive as a raw string — parse it back out.
          let message = err.message ?? `Server error (HTTP ${err.status})`;
          if (typeof err.error === 'string') {
            try {
              message = JSON.parse(err.error)?.message ?? message;
            } catch {
              // err.error wasn't JSON — fall back to the default message above.
            }
          }
          return throwError(() => new Error(message));
        }),
      );
  }

  generateZugferdPdf(xml: string): Observable<Blob> {
    return this.http
      .post(`${this.apiBase}/zugferd/generate`, { xml }, { responseType: 'blob' })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // With responseType 'blob', JSON error bodies also arrive as a Blob — read it back out.
          if (err.error instanceof Blob && err.error.type.includes('json')) {
            return from(err.error.text()).pipe(
              switchMap((text) => {
                const message = JSON.parse(text)?.message ?? `Server error (HTTP ${err.status})`;
                return throwError(() => new Error(message));
              }),
            );
          }
          const message = err.message ?? `Server error (HTTP ${err.status})`;
          return throwError(() => new Error(message));
        }),
      );
  }
}
