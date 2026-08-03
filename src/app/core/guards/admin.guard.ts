import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureReady().then(() => {
    if (authService.currentUser?.role === 'admin') {
      return true;
    }

    return router.createUrlTree(['/login'], {
      queryParams: {
        returnUrl: state.url,
        role: 'admin',
      },
    });
  });
};
