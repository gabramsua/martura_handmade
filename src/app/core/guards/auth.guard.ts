import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureReady().then(() => {
    if (authService.currentUser) {
      return true;
    }

    return router.createUrlTree(['/login'], {
      queryParams: {
        returnUrl: state.url,
        role: state.url.startsWith('/admin') ? 'admin' : 'customer',
      },
    });
  });
};
