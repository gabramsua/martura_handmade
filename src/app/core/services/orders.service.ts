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
import { AuthService } from './auth.service';
import { LocalStorageService } from './local-storage.service';

const ORDERS_STORAGE_KEY = 'martura_orders';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly authService = inject(AuthService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>(this.readInitialOrders());

  readonly orders$ = isFirebaseConfigured && this.firestore
    ? this.authService.isAdmin$.pipe(
        switchMap((isAdmin) => this.getRemoteOrders(isAdmin)),
      )
    : this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => isOrderActive(order.status))),
  );

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
      throw new Error('No se encontró el pedido que intentas actualizar.');
    }

    this.setOrders(
      this.ordersSubject.value.map((entry) =>
        entry.id === orderId
          ? {
              ...entry,
              status,
              updatedAt: new Date(),
            }
          : entry,
      ),
    );
  }

  async clearOrders(): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);
      const ordersSnapshot = await getDocs(collection(this.firestore, firestoreCollections.orders));

      for (const order of ordersSnapshot.docs) {
        batch.delete(order.ref);
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

  private getRemoteOrders(isAdmin: boolean) {
    if (!this.firestore || !isAdmin) {
      return of<CheckoutOrder[]>([]);
    }

    const ordersCollection = collection(this.firestore, firestoreCollections.orders);
    const ordersQuery = query(ordersCollection, orderBy('createdAt', 'desc'));

    return collectionData(ordersQuery, { idField: 'id' }).pipe(
      map((orders) =>
        (orders as Array<SerializedCheckoutOrder>).map((order) => reviveOrder(order)),
      ),
      catchError((error) => {
        console.error('No se pudieron cargar los pedidos desde Firestore.', error);
        return of<CheckoutOrder[]>([]);
      }),
    );
  }

  private readInitialOrders(): CheckoutOrder[] {
    if (isFirebaseConfigured) {
      return [];
    }

    return this.localStorageService.read<CheckoutOrder[]>(ORDERS_STORAGE_KEY, [], (orders) =>
      (orders as Array<CheckoutOrder & { createdAt: unknown }>).map((order) => reviveOrder(order)),
    );
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
