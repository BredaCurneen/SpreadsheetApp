import { Routes } from '@angular/router';
import { UploadComponent } from './components/upload/upload.component';
import { FacturxComponent } from './components/facturx/facturx.component';

export const routes: Routes = [
  { path: '', component: UploadComponent },
  { path: 'facturx', component: FacturxComponent },
  { path: '**', redirectTo: '' },
];
