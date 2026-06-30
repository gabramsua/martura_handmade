import { Injectable } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';

import { CheckoutOrder } from '../models/order.model';

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly ordersSubject = new BehaviorSubject<CheckoutOrder[]>([]);

  readonly orders$ = this.ordersSubject.asObservable();
  readonly pendingOrders$ = this.orders$.pipe(
    map((orders) => orders.filter((order) => order.status !== 'sent')),
  );

  saveDraft(order: CheckoutOrder): void {
    this.ordersSubject.next([order, ...this.ordersSubject.value]);
  }

  markAsSent(orderId: string): void {
    this.ordersSubject.next(
      this.ordersSubject.value.map((order) =>
        order.id === orderId ? { ...order, status: 'sent' } : order,
      ),
    );
  }
}
