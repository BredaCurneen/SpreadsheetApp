import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <nav class="tab-nav">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Convert to UBL</a>
      <a routerLink="/facturx" routerLinkActive="active">Factur-X PDF</a>
      <a routerLink="/pdf-extract" routerLinkActive="active">Extract XML from PDF</a>
      <a routerLink="/xrechnung" routerLinkActive="active">XRechnung</a>
    </nav>
    <router-outlet />
  `,
  styles: [`
    .tab-nav {
      display: flex;
      gap: 0.25rem;
      padding: 0.6rem 1.5rem 0;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
    }
    .tab-nav a {
      padding: 0.5rem 0.9rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #64748b;
      text-decoration: none;
      border-radius: 6px 6px 0 0;
      border: 1px solid transparent;
    }
    .tab-nav a:hover {
      color: #1e293b;
      background: #f8fafc;
    }
    .tab-nav a.active {
      color: #6366f1;
      background: #f8fafc;
      border-color: #e2e8f0;
      border-bottom-color: #f8fafc;
    }
  `],
})
export class App {}
