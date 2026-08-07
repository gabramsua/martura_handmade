import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

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
  private readonly router = inject(Router);
  readonly shopSettingsService = inject(ShopSettingsService);
  readonly mobileMenuOpen = signal(false);

  readonly user$ = this.authService.user$;
  readonly isAdmin$ = this.authService.isAdmin$;
  readonly isAdmin = toSignal(this.isAdmin$, { initialValue: false });
  readonly cartItems$ = this.cartService.totalItems$;
  readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => this.closeMobileMenu());
  }

  async logout(): Promise<void> {
    this.closeMobileMenu();
    await this.authService.logout();
  }

  isPrivateArea(): boolean {
    return this.currentUrl().startsWith('/admin');
  }

  shouldShowCart(): boolean {
    return !this.isAdmin() && !this.isPrivateArea();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((isOpen) => !isOpen);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }
}
