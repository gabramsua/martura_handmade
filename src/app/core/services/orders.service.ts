import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { BehaviorSubject, map } from 'rxjs';

import { CheckoutOrder } from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveOrder } from '../firebase/firestore.mappers';
import { LocalStorageService } from './local-storage.service';

const ORDERS_STORAGE_KEY = 'martura_orders';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>(
    this.readInitialOrders(),
  );

  readonly orders$ = this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => order.status !== 'sent')),
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

  async markAsSent(orderId: string): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await updateDoc(this.getOrderDoc(orderId), {
        status: 'sent',
      });
      return;
    }

    this.setOrders(
      this.ordersSubject.value.map((order) =>
        order.id === orderId ? { ...order, status: 'sent' } : order,
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
}
