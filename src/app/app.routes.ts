import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/home/home').then((component) => component.Home),
  },
  {
    path: 'producto/:slug',
    loadComponent: () =>
      import('./features/product-detail/product-detail').then((component) => component.ProductDetail),
  },
  {
    path: 'carrito',
    loadComponent: () => import('./features/cart/cart').then((component) => component.Cart),
  },
  {
    path: 'checkout',
    loadComponent: () => import('./features/checkout/checkout').then((component) => component.Checkout),
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin').then((component) => component.Admin),
  },
  {
    path: '**',
    redirectTo: '',
  },
];
