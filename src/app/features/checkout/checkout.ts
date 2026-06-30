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
import { OrderPlacementService } from '../../core/services/order-placement.service';

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
  private readonly orderPlacementService = inject(OrderPlacementService);

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
  errorMessage: string | null = null;
  isSubmitting = false;

  constructor() {
    const user = this.authService.currentUser;

    if (user) {
      this.checkoutForm.patchValue({
        name: user.name,
        email: user.email,
      });
    }
  }

  async prepareOrder(summary: CartSummary): Promise<void> {
    if (this.checkoutForm.invalid) {
      this.checkoutForm.markAllAsTouched();
      return;
    }

    try {
      this.isSubmitting = true;

      const order = await this.orderPlacementService.placeOrder(
        summary,
        {
          ...this.checkoutForm.getRawValue(),
          notes: this.checkoutForm.controls.notes.value || null,
        },
        this.authService.currentUser?.id ?? 'mock-user',
      );

      this.errorMessage = null;
      this.lastOrder = order;
      this.whatsappUrl = this.checkoutService.buildWhatsappUrl(order);
      this.cartService.clear();
    } catch {
      this.errorMessage = 'No se pudo guardar el pedido. Intentalo de nuevo.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
