import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  doc,
  runTransaction,
} from '@angular/fire/firestore';

import { CartSummary } from '../models/cart.model';
import { isProductVisible, normalizeProductStatus, ProductStatus } from '../models/product.model';
import { CheckoutOrder, CustomerContact } from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { CheckoutService } from './checkout.service';
import { OrdersService } from './orders.service';
import { ProductsService } from './products.service';

@Injectable({ providedIn: 'root' })
export class OrderPlacementService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly checkoutService = inject(CheckoutService);
  private readonly ordersService = inject(OrdersService);
  private readonly productsService = inject(ProductsService);

  async placeOrder(
    summary: CartSummary,
    customer: CustomerContact,
    userId: string,
  ): Promise<CheckoutOrder> {
    const order = this.checkoutService.buildOrder(summary, customer, userId);

    if (isFirebaseConfigured && this.firestore) {
      await this.placeOrderInFirestore(order);
      return order;
    }

    const stockValidation = this.productsService.validateCartItems(summary.items);

    if (!stockValidation.valid) {
      throw new Error(stockValidation.message ?? 'No se pudo validar el stock del pedido.');
    }

    await this.ordersService.saveDraft(order);
    await this.productsService.reserveOrder(order.items);

    return order;
  }

  private async placeOrderInFirestore(order: CheckoutOrder): Promise<void> {
    const firestore = this.firestore!;

    await runTransaction(firestore, async (transaction) => {
      for (const item of order.items) {
        const productDoc = doc(firestore, firestoreCollections.products, item.productId);
        const productSnapshot = await transaction.get(productDoc);

        if (!productSnapshot.exists()) {
          throw new Error(`La pieza "${item.productName}" ya no esta disponible.`);
        }

        const product = productSnapshot.data() as {
          stock?: number;
          status?: ProductStatus;
        };
        const currentStock = typeof product.stock === 'number' ? product.stock : 0;
        const currentStatus = normalizeProductStatus(product.status, currentStock);

        if (!isProductVisible({ status: currentStatus })) {
          throw new Error(`La pieza "${item.productName}" ya no esta disponible.`);
        }

        if (currentStock < item.quantity) {
          throw new Error(`Solo quedan ${currentStock} unidades de "${item.productName}".`);
        }

        const nextStock = currentStock - item.quantity;

        transaction.update(productDoc, {
          stock: nextStock,
          status: normalizeProductStatus(currentStatus, nextStock),
        });
      }

      const orderDoc = doc(firestore, firestoreCollections.orders, order.id);
      transaction.set(orderDoc, order);
    });
  }
}
