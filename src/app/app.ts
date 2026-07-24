import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from './core/services/auth.service';
import { CartService } from './core/services/cart.service';
import { ShopSettingsService } from './core/services/shop-settings.service';

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
  readonly shopSettingsService = inject(ShopSettingsService);

  readonly user$ = this.authService.user$;
  readonly isAdmin$ = this.authService.isAdmin$;
  readonly cartItems$ = this.cartService.totalItems$;

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
