import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from './core/services/auth.service';
import { CartService } from './core/services/cart.service';

@Component({
  selector: 'app-root',
  imports: [AsyncPipe, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);

  readonly user$ = this.authService.user$;
  readonly isAuthenticated$ = this.authService.isAuthenticated$;
  readonly isAdmin$ = this.authService.isAdmin$;
  readonly isCustomer$ = this.user$.pipe(map((user) => user?.role === 'customer'));
  readonly cartItems$ = this.cartService.totalItems$;

  logout(): void {
    this.authService.logout();
  }
}
