import { Routes } from '@angular/router';
import { UploadComponent } from './components/upload/upload.component';
import { FacturxComponent } from './components/facturx/facturx.component';
import { PdfExtractComponent } from './components/pdf-extract/pdf-extract.component';
import { XRechnungComponent } from './components/xrechnung/xrechnung.component';

export const routes: Routes = [
  { path: '', component: UploadComponent },
  { path: 'facturx', component: FacturxComponent },
  { path: 'pdf-extract', component: PdfExtractComponent },
  { path: 'xrechnung', component: XRechnungComponent },
  { path: '**', redirectTo: '' },
];
