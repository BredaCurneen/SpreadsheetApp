import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
}
