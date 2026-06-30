import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';

import { CheckoutOrder, getOrderStatusLabel } from '../../core/models/order.model';
import { AuthService } from '../../core/services/auth.service';
import { OrdersService } from '../../core/services/orders.service';

@Component({
  selector: 'app-orders',
  imports: [AsyncPipe, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './orders.html',
  styleUrl: './orders.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Orders {
  private readonly authService = inject(AuthService);
  private readonly ordersService = inject(OrdersService);

  readonly orders$ = this.authService.user$.pipe(
    switchMap((user) => this.ordersService.getOrdersForUser(user?.id ?? null)),
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
}
