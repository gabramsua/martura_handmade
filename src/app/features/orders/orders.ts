import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

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

  readonly orders$ = this.ordersService.getOrdersForUser(this.authService.currentUser?.id ?? '');
}
