import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { CartItem, CartSummary } from '../../core/models/cart.model';
import { CheckoutOrder } from '../../core/models/order.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { AuthService } from '../../core/services/auth.service';
import { CampaignsService } from '../../core/services/campaigns.service';
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
  private readonly campaignsService = inject(CampaignsService);
  private readonly cartService = inject(CartService);
  private readonly checkoutService = inject(CheckoutService);
  private readonly orderPlacementService = inject(OrderPlacementService);

  readonly summary$ = this.cartService.summary$;
  readonly canCheckout$ = this.summary$.pipe(map((summary) => summary.items.length > 0));
  readonly checkoutForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.pattern(/^[0-9+\s]{9,15}$/)]],
    deliveryMethod: ['shipping' as const, [Validators.required]],
    addressLine1: [''],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
    city: ['', [Validators.required]],
    province: ['', [Validators.required]],
    notes: [''],
    acceptsPolicies: [false, [Validators.requiredTrue]],
  }, {
    validators: [this.shippingAddressValidator],
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
      const value = this.checkoutForm.getRawValue();

      const order = await this.orderPlacementService.placeOrder(
        summary,
        {
          name: value.name,
          email: value.email,
          phone: value.phone,
          deliveryMethod: value.deliveryMethod,
          addressLine1: value.deliveryMethod === 'shipping'
            ? value.addressLine1
            : null,
          postalCode: value.postalCode,
          city: value.city,
          province: value.province,
          notes: value.notes || null,
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

  getLineTotal(item: CartItem): number {
    return (
      resolveProductPricing(item.product, this.campaignsService.activeCampaignsSnapshot).effectivePrice *
      item.quantity
    );
  }

  get isShipping(): boolean {
    return this.checkoutForm.controls.deliveryMethod.value === 'shipping';
  }

  get addressErrorMessage(): string | null {
    return this.checkoutForm.errors?.['missingAddress']
      ? 'La direccion es obligatoria cuando el pedido va con envio.'
      : null;
  }

  getDeliveryLabel(method: 'shipping' | 'pickup'): string {
    return method === 'shipping' ? 'Envio' : 'Recogida';
  }

  private shippingAddressValidator(control: AbstractControl): ValidationErrors | null {
    const deliveryMethod = control.get('deliveryMethod')?.value as 'shipping' | 'pickup' | undefined;
    const addressLine1 = String(control.get('addressLine1')?.value ?? '').trim();

    if (deliveryMethod === 'shipping' && !addressLine1) {
      return { missingAddress: true };
    }

    return null;
  }
}
