import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { combineLatest, map, startWith, switchMap } from 'rxjs';

import { CheckoutOrder, getOrderStatusLabel } from '../../core/models/order.model';
import { AuthService } from '../../core/services/auth.service';
import { OrdersService } from '../../core/services/orders.service';

@Component({
  selector: 'app-orders',
  imports: [AsyncPipe, CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Orders {
  private readonly authService = inject(AuthService);
  private readonly ordersService = inject(OrdersService);

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly user$ = this.authService.user$;
  readonly orders$ = this.user$.pipe(
    switchMap((user) => this.ordersService.getOrdersForUser(user?.id ?? null)),
    map((orders) => [...orders].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())),
  );
  readonly filteredOrders$ = combineLatest([
    this.orders$,
    this.searchControl.valueChanges.pipe(
      startWith(this.searchControl.value),
      map((value) => value.trim().toLowerCase()),
    ),
  ]).pipe(
    map(([orders, query]) => {
      if (!query) {
        return orders;
      }

      return orders.filter((order) =>
        order.id.toLowerCase().includes(query) ||
        order.items.some((item) =>
          item.productName.toLowerCase().includes(query) ||
          item.variant.toLowerCase().includes(query),
        ),
      );
    }),
  );
  readonly accountSummary$ = combineLatest([this.user$, this.orders$]).pipe(
    map(([user, orders]) => {
      const lastOrder = orders[0] ?? null;
      const deliveryCounts = orders.reduce(
        (accumulator, order) => {
          accumulator[order.customer.deliveryMethod] += 1;
          return accumulator;
        },
        { shipping: 0, pickup: 0 } as Record<'shipping' | 'pickup', number>,
      );
      const preferredDelivery: 'shipping' | 'pickup' | null =
        deliveryCounts.shipping === 0 && deliveryCounts.pickup === 0
          ? null
          : deliveryCounts.shipping >= deliveryCounts.pickup
            ? 'shipping'
            : 'pickup';

      return {
        user,
        orders,
        totalOrders: orders.length,
        activeOrders: orders.filter((order) => order.status !== 'completed' && order.status !== 'cancelled').length,
        lastOrder,
        preferredDelivery,
        lastPhone: lastOrder?.customer.phone ?? null,
        lastDestination: lastOrder ? this.getDestination(lastOrder) : null,
      };
    }),
  );

  getOrderStatus(order: CheckoutOrder): string {
    return getOrderStatusLabel(order.status, order.customer.deliveryMethod);
  }

  getDestination(order: CheckoutOrder): string {
    if (order.customer.deliveryMethod === 'pickup') {
      return 'Recogida en taller';
    }

    const parts = [order.customer.addressLine1, `${order.customer.postalCode} ${order.customer.city}`]
      .filter(Boolean);

    return parts.join(' - ');
  }

  getDeliveryLabel(method: 'shipping' | 'pickup' | null): string {
    if (method === 'shipping') {
      return 'Envío';
    }

    if (method === 'pickup') {
      return 'Recogida';
    }

    return 'Sin pedidos aún';
  }

  focusOrder(orderId: string): void {
    this.searchControl.setValue(orderId);
    setTimeout(() => {
      document.getElementById(`order-${orderId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  }

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
