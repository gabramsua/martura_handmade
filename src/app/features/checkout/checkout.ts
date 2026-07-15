import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
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
import { AlertsService } from '../../core/services/alerts.service';
import { AuthService } from '../../core/services/auth.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';
import { CheckoutService } from '../../core/services/checkout.service';
import { OrderPlacementService } from '../../core/services/order-placement.service';

@Component({
  selector: 'app-checkout',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    MatProgressBarModule,
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
  submissionMessage: string | null = null;
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
      this.submissionMessage = 'Validando stock y preparando tu pedido...';
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

      this.submissionMessage = 'Preparando la confirmación y el mensaje de WhatsApp...';
      this.lastOrder = order;
      this.whatsappUrl = this.checkoutService.buildWhatsappUrl(order);
      this.cartService.clear();
      await this.alertsService.success(
        'Pedido preparado',
        'Hemos registrado el pedido y dejado listo el mensaje de WhatsApp para enviarlo.',
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

  get isShipping(): boolean {
    return this.checkoutForm.controls.deliveryMethod.value === 'shipping';
  }

  get addressErrorMessage(): string | null {
    return this.checkoutForm.errors?.['missingAddress']
      ? 'La dirección es obligatoria cuando el pedido va con envío.'
      : null;
  }

  get deliveryHelpText(): string {
    return this.isShipping
      ? 'Te pediremos la dirección completa para preparar el envío.'
      : 'Si eliges recogida, no necesitamos dirección postal.';
  }

  getDeliveryLabel(method: 'shipping' | 'pickup'): string {
    return method === 'shipping' ? 'Envío' : 'Recogida';
  }

  getControlErrorMessage(
    controlName:
      | 'name'
      | 'email'
      | 'phone'
      | 'addressLine1'
      | 'postalCode'
      | 'city'
      | 'province'
      | 'acceptsPolicies',
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

    if (control.hasError('minlength') && controlName === 'name') {
      return 'Escribe al menos 2 caracteres.';
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

    return null;
  }

  private shippingAddressValidator(control: AbstractControl): ValidationErrors | null {
    const deliveryMethod = control.get('deliveryMethod')?.value as 'shipping' | 'pickup' | undefined;
    const addressLine1 = String(control.get('addressLine1')?.value ?? '').trim();

    if (deliveryMethod === 'shipping' && !addressLine1) {
      return { missingAddress: true };
    }

    return null;
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

    if (this.checkoutForm.errors?.['missingAddress']) {
      return 'Completa la dirección de envío para continuar.';
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
