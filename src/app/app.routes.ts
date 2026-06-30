import { Routes } from '@angular/router';

import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';

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
    canActivate: [authGuard],
    loadComponent: () => import('./features/checkout/checkout').then((component) => component.Checkout),
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
