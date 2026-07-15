import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const customerGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const currentUser = authService.currentUser;

  if (currentUser?.role === 'customer') {
    return true;
  }

  if (currentUser?.role === 'admin') {
    return router.createUrlTree(['/admin'], {
      queryParams: {
        redirectFrom: state.url,
      },
    });
  }

  return router.createUrlTree(['/login'], {
    queryParams: {
      returnUrl: state.url,
      role: 'customer',
    },
  });
};

export const customerJourneyGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.currentUser?.role === 'admin') {
    return router.createUrlTree(['/admin'], {
      queryParams: {
        redirectFrom: state.url,
      },
    });
  }

  return true;
};
