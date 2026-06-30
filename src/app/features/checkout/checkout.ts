import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { CartSummary } from '../../core/models/cart.model';
import { CheckoutOrder } from '../../core/models/order.model';
import { AuthService } from '../../core/services/auth.service';
import { CartService } from '../../core/services/cart.service';
import { CheckoutService } from '../../core/services/checkout.service';
import { OrdersService } from '../../core/services/orders.service';

@Component({
  selector: 'app-checkout',
  imports: [AsyncPipe, CurrencyPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkout {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly cartService = inject(CartService);
  private readonly checkoutService = inject(CheckoutService);
  private readonly ordersService = inject(OrdersService);

  readonly summary$ = this.cartService.summary$;
  readonly canCheckout$ = this.summary$.pipe(map((summary) => summary.items.length > 0));
  readonly checkoutForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.minLength(9)]],
    city: ['', [Validators.required]],
    notes: [''],
  });

  lastOrder: CheckoutOrder | null = null;
  whatsappUrl: string | null = null;

  constructor() {
    const user = this.authService.currentUser;

    if (user) {
      this.checkoutForm.patchValue({
        name: user.name,
        email: user.email,
      });
    }
  }

  prepareOrder(summary: CartSummary): void {
    if (this.checkoutForm.invalid) {
      this.checkoutForm.markAllAsTouched();
      return;
    }

    const order = this.checkoutService.buildOrder(
      summary,
      {
        ...this.checkoutForm.getRawValue(),
        notes: this.checkoutForm.controls.notes.value || null,
      },
      this.authService.currentUser?.id ?? 'mock-user',
    );

    this.lastOrder = order;
    this.whatsappUrl = this.checkoutService.buildWhatsappUrl(order);
    this.ordersService.saveDraft(order);
  }
}
