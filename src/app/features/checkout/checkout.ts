import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { combineLatest, map, startWith } from 'rxjs';

import { CartItem, CartSummary } from '../../core/models/cart.model';
import { cartItemToOrderItem, CheckoutOrder } from '../../core/models/order.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { AlertsService } from '../../core/services/alerts.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';
import { DiscountCodesService } from '../../core/services/discount-codes.service';
import { OrderPlacementService } from '../../core/services/order-placement.service';
import { ShopSettingsService } from '../../core/services/shop-settings.service';

@Component({
  selector: 'app-checkout',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './checkout.html',
  styleUrl: './checkout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Checkout {
  private readonly formBuilder = inject(FormBuilder);
  private readonly alertsService = inject(AlertsService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly cartService = inject(CartService);
  private readonly discountCodesService = inject(DiscountCodesService);
  private readonly orderPlacementService = inject(OrderPlacementService);
  readonly shopSettingsService = inject(ShopSettingsService);

  readonly summary$ = this.cartService.summary$;
  readonly canCheckout$ = this.summary$.pipe(map((summary) => summary.items.length > 0));
  readonly checkoutForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    phone: ['', [Validators.required, Validators.pattern(/^[0-9+\s]{9,15}$/)]],
    dni: ['', [Validators.required, Validators.minLength(8)]],
    addressLine1: ['', [Validators.required]],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{5}$/)]],
    city: ['', [Validators.required]],
    province: ['', [Validators.required]],
    comments: [''],
    discountCode: [''],
    acceptsPolicies: [false, [Validators.requiredTrue]],
  });

  readonly discountPreview$ = combineLatest([
    this.summary$,
    this.checkoutForm.controls.discountCode.valueChanges.pipe(
      startWith(this.checkoutForm.controls.discountCode.value),
    ),
  ]).pipe(
    map(([summary, discountCode]) => this.resolveDiscount(summary, discountCode)),
  );
  readonly finalTotal$ = combineLatest([this.summary$, this.discountPreview$]).pipe(
    map(([summary, discount]) => Math.max(0, summary.total - (discount?.amount ?? 0))),
  );

  lastOrder: CheckoutOrder | null = null;
  errorMessage: string | null = null;
  submissionMessage: string | null = null;
  isSubmitting = false;

  async prepareOrder(summary: CartSummary): Promise<void> {
    if (!summary.items.length) {
      this.errorMessage = 'Tu carrito está vacío. Añade al menos una pieza antes de cerrar el pedido.';
      await this.alertsService.error('Carrito vacío', this.errorMessage);
      return;
    }

    if (this.checkoutForm.invalid) {
      this.errorMessage = this.getCheckoutValidationMessage();
      this.checkoutForm.markAllAsTouched();
      await this.alertsService.error('Revisa el pedido', this.errorMessage);
      return;
    }

    try {
      this.isSubmitting = true;
      this.errorMessage = null;
      this.submissionMessage = 'Validando stock, descuento y total final del pedido...';
      const value = this.checkoutForm.getRawValue();
      const resolvedDiscount = this.resolveDiscount(summary, value.discountCode);

      if (value.discountCode.trim() && !resolvedDiscount) {
        throw new Error('Ese código no existe, no está activo o no aplica a los productos de este pedido.');
      }

      const order = await this.orderPlacementService.placeOrder(
        summary,
        {
          name: value.name,
          email: value.email,
          phone: value.phone,
          dni: value.dni,
          deliveryMethod: 'shipping',
          addressLine1: value.addressLine1,
          postalCode: value.postalCode,
          city: value.city,
          province: value.province,
          comments: value.comments || null,
        },
        value.discountCode || null,
      );

      this.lastOrder = order;
      this.cartService.clear();
      await this.alertsService.success(
        'Pedido creado',
        'Tu pedido ya está registrado. Ahora puedes completar el pago por Bizum con la referencia indicada.',
      );
    } catch (error) {
      this.errorMessage = error instanceof Error
        ? error.message
        : 'No se pudo guardar el pedido. Inténtalo de nuevo.';
      await this.alertsService.error('No se pudo guardar el pedido', this.errorMessage);
    } finally {
      this.isSubmitting = false;
      this.submissionMessage = null;
    }
  }

  getLineTotal(item: CartItem): number {
    return (
      resolveProductPricing(item.product, this.campaignsService.activeCampaignsSnapshot).effectivePrice *
      item.quantity
    );
  }

  getControlErrorMessage(
    controlName:
      | 'name'
      | 'email'
      | 'phone'
      | 'dni'
      | 'addressLine1'
      | 'postalCode'
      | 'city'
      | 'province'
      | 'acceptsPolicies'
      | 'discountCode',
  ): string | null {
    const control = this.checkoutForm.controls[controlName];

    if (!control || !control.touched) {
      return null;
    }

    if (control.hasError('required')) {
      switch (controlName) {
        case 'name':
          return 'Indica el nombre de la persona que hace el pedido.';
        case 'email':
          return 'Necesitamos un correo para asociar el pedido.';
        case 'phone':
          return 'Necesitamos un teléfono de contacto.';
        case 'dni':
          return 'El DNI es obligatorio para cerrar el pedido.';
        case 'addressLine1':
          return 'La dirección de envío es obligatoria.';
        case 'postalCode':
          return 'El código postal es obligatorio.';
        case 'city':
          return 'La ciudad es obligatoria.';
        case 'province':
          return 'La provincia es obligatoria.';
        default:
          return 'Este campo es obligatorio.';
      }
    }

    if (control.hasError('minlength')) {
      if (controlName === 'name') {
        return 'Escribe al menos 2 caracteres.';
      }

      if (controlName === 'dni') {
        return 'El DNI parece demasiado corto.';
      }
    }

    if (control.hasError('email')) {
      return 'Escribe un correo válido.';
    }

    if (control.hasError('pattern')) {
      switch (controlName) {
        case 'phone':
          return 'Escribe un teléfono válido de entre 9 y 15 caracteres.';
        case 'postalCode':
          return 'El código postal debe tener 5 dígitos.';
        default:
          return 'El formato no es válido.';
      }
    }

    if (control.hasError('requiredTrue') && controlName === 'acceptsPolicies') {
      return 'Debes aceptar el uso de datos para continuar.';
    }

    if (control.hasError('invalidDiscountCode')) {
      return 'Ese código no existe, no está activo o no aplica a este pedido.';
    }

    return null;
  }

  private resolveDiscount(summary: CartSummary, discountCode: string | null) {
    const orderItems = summary.items.map((item) =>
      cartItemToOrderItem(item, this.campaignsService.activeCampaignsSnapshot),
    );

    return this.discountCodesService.resolveDiscount(discountCode, orderItems);
  }

  private getCheckoutValidationMessage(): string {
    if (this.checkoutForm.controls.name.invalid) {
      return 'Revisa el nombre de contacto antes de continuar.';
    }

    if (this.checkoutForm.controls.email.invalid) {
      return 'Revisa el correo electrónico antes de continuar.';
    }

    if (this.checkoutForm.controls.phone.invalid) {
      return 'Revisa el teléfono de contacto antes de continuar.';
    }

    if (this.checkoutForm.controls.dni.invalid) {
      return 'Revisa el DNI antes de continuar.';
    }

    if (this.checkoutForm.controls.addressLine1.invalid) {
      return 'Completa la dirección de envío antes de continuar.';
    }

    if (this.checkoutForm.controls.postalCode.invalid) {
      return 'Revisa el código postal antes de continuar.';
    }

    if (this.checkoutForm.controls.city.invalid || this.checkoutForm.controls.province.invalid) {
      return 'Completa la ciudad y la provincia antes de continuar.';
    }

    if (this.checkoutForm.controls.acceptsPolicies.invalid) {
      return 'Debes aceptar el uso de datos para poder preparar el pedido.';
    }

    return 'Revisa los datos del pedido antes de continuar.';
  }
}
