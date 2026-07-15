import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { FirebaseError } from 'firebase/app';
import { BehaviorSubject, catchError, map, of, switchMap } from 'rxjs';

import {
  CheckoutOrder,
  isOrderActive,
  OrderStatus,
  SerializedCheckoutOrder,
  UpdateOrderStatusPayload,
} from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { getMarturaFunctions } from '../firebase/firebase.lazy';
import { reviveOrder } from '../firebase/firestore.mappers';
import { AppUser } from '../models/user.model';
import { isProductVisible, normalizeProductStatus, ProductStatus } from '../models/product.model';
import { AuthService } from './auth.service';
import { LocalStorageService } from './local-storage.service';
import { ProductsService } from './products.service';

const ORDERS_STORAGE_KEY = 'martura_orders';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly authService = inject(AuthService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly productsService = inject(ProductsService);
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>(
    this.readInitialOrders(),
  );

  readonly orders$ = isFirebaseConfigured && this.firestore
    ? this.authService.user$.pipe(
        switchMap((user) => this.getRemoteOrders(user)),
      )
    : this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => isOrderActive(order.status))),
  );

  getOrdersForUser(userId: string | null) {
    return this.orders$.pipe(
      map((orders) => orders.filter((order) => !!userId && order.userId === userId)),
    );
  }

  async saveDraft(order: CheckoutOrder): Promise<void> {
    this.setOrders([order, ...this.ordersSubject.value]);
  }

  async updateStatus(orderId: string, status: OrderStatus): Promise<void> {
    if (isFirebaseConfigured) {
      const functions = await getMarturaFunctions();

      if (!functions) {
        throw new Error('Firebase Functions no está disponible en la app. Revisa la configuración.');
      }

      await this.updateStatusWithFunction(functions, orderId, status);
      return;
    }

    const order = this.ordersSubject.value.find((entry) => entry.id === orderId);

    if (!order) {
      throw new Error('No se encontro el pedido que intentas actualizar.');
    }

    if (order.status === status) {
      return;
    }

    const updatedAt = new Date();

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
      const ordersCollection = collection(this.firestore, firestoreCollections.orders);
      const customersCollection = collection(this.firestore, firestoreCollections.customers);
      const snapshot = await getDocs(ordersCollection);
      const customersSnapshot = await getDocs(customersCollection);

      for (const order of snapshot.docs) {
        batch.delete(order.ref);
      }

      for (const customer of customersSnapshot.docs) {
        batch.delete(customer.ref);
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

  private getRemoteOrders(user: AppUser | null) {
    if (!this.firestore || !user) {
      return of<CheckoutOrder[]>([]);
    }

    const ordersCollection = collection(this.firestore, firestoreCollections.orders);
    const ordersQuery = user.role === 'admin'
      ? query(ordersCollection, orderBy('createdAt', 'desc'))
      : query(
          ordersCollection,
          where('userId', '==', user.id),
        );

    return collectionData(ordersQuery, { idField: 'id' }).pipe(
      map((orders) =>
        this.sortOrdersByCreatedAt(
          (orders as Array<SerializedCheckoutOrder>).map((order) => reviveOrder(order)),
        ),
      ),
      catchError((error) => {
        console.error('No se pudieron cargar los pedidos desde Firestore.', error);
        return of<CheckoutOrder[]>([]);
      }),
    );
  }

  private sortOrdersByCreatedAt(orders: CheckoutOrder[]): CheckoutOrder[] {
    return [...orders].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
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

  private async updateStatusWithFunction(
    functions: NonNullable<Awaited<ReturnType<typeof getMarturaFunctions>>>,
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    try {
      const { httpsCallable } = await import('firebase/functions');
      const updateOrderStatus = httpsCallable<UpdateOrderStatusPayload, SerializedCheckoutOrder>(
        functions,
        'updateOrderStatus',
      );
      await updateOrderStatus({ orderId, status });
    } catch (error) {
      throw this.mapFunctionsError(error);
    }
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
      case 'functions/permission-denied':
        return new Error('Tu cuenta no puede gestionar pedidos desde este panel.');
      case 'functions/failed-precondition':
      case 'functions/not-found':
      case 'functions/invalid-argument':
        return new Error(message ?? 'No se pudo actualizar el pedido con el estado solicitado.');
      default:
        return error instanceof Error && error.message
          ? error
          : new Error('No se pudo actualizar el pedido desde Firebase Functions.');
    }
  }
}
