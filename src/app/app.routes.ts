import { Routes } from '@angular/router';

import { adminGuard } from './core/guards/admin.guard';
import { Cart } from './features/cart/cart';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((component) => component.Home),
  },
  {
    path: 'catalogo',
    loadComponent: () => import('./features/catalog/catalog').then((component) => component.Catalog),
  },
  {
    path: 'sobre-mi',
    loadComponent: () => import('./features/about/about').then((component) => component.About),
  },
  {
    path: 'producto/:slug',
    loadComponent: () =>
      import('./features/product-detail/product-detail').then((component) => component.ProductDetail),
  },
  {
    path: 'carrito',
    component: Cart,
  },
  {
    path: 'checkout',
    loadComponent: () => import('./features/checkout/checkout').then((component) => component.Checkout),
  },
  {
    path: 'consultas',
    loadComponent: () => import('./features/contact/contact').then((component) => component.Contact),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((component) => component.Login),
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/admin').then((component) => component.Admin),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
