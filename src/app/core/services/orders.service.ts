import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  runTransaction,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { BehaviorSubject, map } from 'rxjs';

import { CheckoutOrder, isOrderActive, OrderStatus } from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveOrder } from '../firebase/firestore.mappers';
import { isProductVisible, normalizeProductStatus, ProductStatus } from '../models/product.model';
import { LocalStorageService } from './local-storage.service';
import { ProductsService } from './products.service';

const ORDERS_STORAGE_KEY = 'martura_orders';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly productsService = inject(ProductsService);
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>(
    this.readInitialOrders(),
  );

  readonly orders$ = this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => isOrderActive(order.status))),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    const ordersCollection = collection(this.firestore, firestoreCollections.orders);
    const ordersQuery = query(ordersCollection, orderBy('createdAt', 'desc'));

    collectionData(ordersQuery, { idField: 'id' }).subscribe({
      next: (orders) => {
        this.ordersSubject.next(
          (orders as Array<CheckoutOrder & { createdAt: unknown }>).map((order) =>
            reviveOrder(order),
          ),
        );
      },
    });
  }

  getOrdersForUser(userId: string | null) {
    return this.orders$.pipe(
      map((orders) => orders.filter((order) => !!userId && order.userId === userId)),
    );
  }

  async saveDraft(order: CheckoutOrder): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getOrderDoc(order.id), order);
      return;
    }

    this.setOrders([order, ...this.ordersSubject.value]);
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    const order = this.ordersSubject.value.find((entry) => entry.id === orderId);

    if (!order) {
      throw new Error('No se encontro el pedido que intentas actualizar.');
    }

    if (order.status === status) {
      return;
    }

    const updatedAt = new Date();

    if (isFirebaseConfigured && this.firestore) {
      await this.updateStatusInFirestore(orderId, status, updatedAt);
      return;
    }

    if (this.shouldReleaseInventory(order.status, status)) {
      await this.productsService.releaseOrder(order.items);
    }

    if (this.shouldReserveInventory(order.status, status)) {
      await this.productsService.reserveOrder(order.items);
    }

    this.setOrders(
      this.ordersSubject.value.map((order) =>
        order.id === orderId ? { ...order, status, updatedAt } : order,
      ),
    );
  }

  async clearOrders(): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const order of this.ordersSubject.value) {
        batch.delete(this.getOrderDoc(order.id));
      }

      await batch.commit();
      return;
    }

    this.setOrders([]);
  }

  private setOrders(orders: CheckoutOrder[]): void {
    this.ordersSubject.next(orders);
    this.localStorageService.write(ORDERS_STORAGE_KEY, orders);
  }

  private readInitialOrders(): CheckoutOrder[] {
    if (isFirebaseConfigured) {
      return [];
    }

    return this.localStorageService.read<CheckoutOrder[]>(ORDERS_STORAGE_KEY, [], (orders) =>
      (orders as Array<CheckoutOrder & { createdAt: unknown }>).map((order) => reviveOrder(order)),
    );
  }

  private getOrderDoc(orderId: string) {
    return doc(this.firestore!, firestoreCollections.orders, orderId);
  }

  private async updateStatusInFirestore(
    orderId: string,
    status: OrderStatus,
    updatedAt: Date,
  ): Promise<void> {
    const firestore = this.firestore!;

    await runTransaction(firestore, async (transaction) => {
      const orderDoc = this.getOrderDoc(orderId);
      const orderSnapshot = await transaction.get(orderDoc);

      if (!orderSnapshot.exists()) {
        throw new Error('No se encontro el pedido que intentas actualizar.');
      }

      const order = reviveOrder({
        id: orderId,
        ...(orderSnapshot.data() as Omit<CheckoutOrder, 'id' | 'createdAt' | 'updatedAt'> & {
          createdAt: unknown;
          updatedAt?: unknown;
        }),
      });

      if (this.shouldReleaseInventory(order.status, status)) {
        const quantities = this.groupOrderItems(order);

        for (const [productId, quantity] of quantities.entries()) {
          const productDoc = doc(firestore, firestoreCollections.products, productId);
          const productSnapshot = await transaction.get(productDoc);

          if (!productSnapshot.exists()) {
            continue;
          }

          const product = productSnapshot.data() as {
            stock?: number;
            status?: ProductStatus;
          };
          const currentStock = typeof product.stock === 'number' ? product.stock : 0;
          const currentStatus = normalizeProductStatus(product.status, currentStock);
          const nextStock = currentStock + quantity;

          transaction.update(productDoc, {
            stock: nextStock,
            status: normalizeProductStatus(currentStatus, nextStock),
          });
        }
      }

      if (this.shouldReserveInventory(order.status, status)) {
        const quantities = this.groupOrderItems(order);

        for (const [productId, quantity] of quantities.entries()) {
          const productDoc = doc(firestore, firestoreCollections.products, productId);
          const productSnapshot = await transaction.get(productDoc);

          if (!productSnapshot.exists()) {
            const item = order.items.find((entry) => entry.productId === productId);
            throw new Error(`La pieza "${item?.productName ?? productId}" ya no esta disponible.`);
          }

          const product = productSnapshot.data() as {
            stock?: number;
            status?: ProductStatus;
          };
          const currentStock = typeof product.stock === 'number' ? product.stock : 0;
          const currentStatus = normalizeProductStatus(product.status, currentStock);
          const item = order.items.find((entry) => entry.productId === productId);

          if (!isProductVisible({ status: currentStatus })) {
            throw new Error(`La pieza "${item?.productName ?? productId}" ya no esta disponible.`);
          }

          if (currentStock < quantity) {
            throw new Error(`Solo quedan ${currentStock} unidades de "${item?.productName ?? productId}".`);
          }

          const nextStock = currentStock - quantity;

          transaction.update(productDoc, {
            stock: nextStock,
            status: normalizeProductStatus(currentStatus, nextStock),
          });
        }
      }

      transaction.update(orderDoc, {
        status,
        updatedAt,
      });
    });
  }

  private shouldReleaseInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
    return currentStatus !== 'cancelled' && nextStatus === 'cancelled';
  }

  private shouldReserveInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
    return currentStatus === 'cancelled' && nextStatus !== 'cancelled';
  }

  private groupOrderItems(order: CheckoutOrder): Map<string, number> {
    return order.items.reduce((quantities, item) => {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
      return quantities;
    }, new Map<string, number>());
  }
}
