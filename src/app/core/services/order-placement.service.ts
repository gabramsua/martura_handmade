import { Injectable, inject } from '@angular/core';
import { FirebaseError } from 'firebase/app';

import { CartSummary } from '../models/cart.model';
import {
  cartItemToOrderItem,
  CreateOrderPayload,
  CustomerContact,
  SerializedCheckoutOrder,
} from '../models/order.model';
import { isFirebaseConfigured } from '../firebase/firebase.config';
import { getMarturaFunctions } from '../firebase/firebase.lazy';
import { reviveOrder } from '../firebase/firestore.mappers';
import { CampaignsService } from './campaigns.service';
import { CheckoutService } from './checkout.service';
import { DiscountCodesService } from './discount-codes.service';
import { OrdersService } from './orders.service';
import { ProductsService } from './products.service';

@Injectable({ providedIn: 'root' })
export class OrderPlacementService {
  private readonly campaignsService = inject(CampaignsService);
  private readonly checkoutService = inject(CheckoutService);
  private readonly discountCodesService = inject(DiscountCodesService);
  private readonly ordersService = inject(OrdersService);
  private readonly productsService = inject(ProductsService);

  async placeOrder(
    summary: CartSummary,
    customer: CustomerContact,
    discountCode: string | null,
  ) {
    if (isFirebaseConfigured) {
      const functions = await getMarturaFunctions();

      if (!functions) {
        throw new Error('Firebase Functions no está disponible en la app. Revisa la configuración.');
      }

      return this.placeOrderWithFunction(functions, customer, summary, discountCode);
    }

    const items = summary.items.map((item) =>
      cartItemToOrderItem(item, this.campaignsService.activeCampaignsSnapshot),
    );
    const resolvedDiscount = this.discountCodesService.resolveDiscount(discountCode, items);
    const order = this.checkoutService.buildOrder(
      summary,
      customer,
      resolvedDiscount
        ? {
            code: resolvedDiscount.code.code,
            description: resolvedDiscount.code.description,
            amount: resolvedDiscount.amount,
          }
        : null,
    );

    const stockValidation = this.productsService.validateCartItems(summary.items);

    if (!stockValidation.valid) {
      throw new Error(stockValidation.message ?? 'No se pudo validar el stock del pedido.');
    }

    await this.ordersService.saveDraft(order);
    await this.productsService.reserveOrder(order.items);

    return order;
  }

  private async placeOrderWithFunction(
    functions: NonNullable<Awaited<ReturnType<typeof getMarturaFunctions>>>,
    customer: CustomerContact,
    summary: CartSummary,
    discountCode: string | null,
  ) {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const createOrder = httpsCallable<CreateOrderPayload, SerializedCheckoutOrder>(
        functions,
        'createOrder',
      );
      const result = await createOrder({
        customer,
        items: summary.items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          variant: item.variant,
        })),
        discountCode: discountCode?.trim().toUpperCase() || null,
      });

      return reviveOrder(result.data);
    } catch (error) {
      throw this.mapFunctionsError(error);
    }
  }

  private mapFunctionsError(error: unknown): Error {
    const code =
      error instanceof FirebaseError
        ? error.code
        : typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : null;
    const message =
      typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : null;

    switch (code) {
      case 'functions/unauthenticated':
        return new Error(
          'El backend de pedidos está pidiendo inicio de sesión, pero el checkout ya es anónimo. Despliega la última versión de la función createOrder y vuelve a probar.',
        );
      case 'functions/permission-denied':
        return new Error(
          'El backend de pedidos está rechazando la operación. Revisa que createOrder no esté protegida por autenticación ni por reglas antiguas.',
        );
      case 'functions/failed-precondition':
      case 'functions/not-found':
      case 'functions/invalid-argument':
        return new Error(message ?? 'El pedido no se pudo validar con los datos actuales.');
      case 'functions/deadline-exceeded':
        return new Error('La creación del pedido está tardando demasiado. Espera unos segundos y vuelve a intentarlo.');
      case 'functions/unavailable':
        return new Error('No hemos podido contactar con el servidor de pedidos. Revisa tu conexión y vuelve a probar.');
      case 'functions/internal':
        return new Error(
          message?.includes('CORS')
            ? 'La app no ha podido completar la petición al servidor de pedidos. Revisa la configuración de Firebase Functions y vuelve a intentarlo.'
            : 'El servidor de pedidos ha devuelto un error interno. Si vuelve a pasar, revisa Firebase Functions y sus logs.',
        );
      default:
        if (error instanceof Error && error.message) {
          return new Error(error.message.replace(/^FirebaseError:\s*/i, '').trim());
        }

        return new Error('No se pudo crear el pedido desde Firebase Functions.');
    }
  }
}
