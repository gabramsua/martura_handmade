import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';

import { CheckoutOrder } from '../models/order.model';
import { LocalStorageService } from './local-storage.service';

const ORDERS_STORAGE_KEY = 'martura_orders';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>(
    this.localStorageService.read(ORDERS_STORAGE_KEY, [], this.reviveOrders),
  );

  readonly orders$ = this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => order.status !== 'sent')),
  );

  getOrdersForUser(userId: string) {
    return this.orders$.pipe(map((orders) => orders.filter((order) => order.userId === userId)));
  }

  saveDraft(order: CheckoutOrder): void {
    this.setOrders([order, ...this.ordersSubject.value]);
  }

  markAsSent(orderId: string): void {
    this.setOrders(
      this.ordersSubject.value.map((order) =>
        order.id === orderId ? { ...order, status: 'sent' } : order,
      ),
    );
  }

  clearOrders(): void {
    this.setOrders([]);
  }

  private setOrders(orders: CheckoutOrder[]): void {
    this.ordersSubject.next(orders);
    this.localStorageService.write(ORDERS_STORAGE_KEY, orders);
  }

  private reviveOrders(orders: CheckoutOrder[]): CheckoutOrder[] {
    return orders.map((order) => ({
      ...order,
      createdAt: new Date(order.createdAt),
    }));
  }
}
