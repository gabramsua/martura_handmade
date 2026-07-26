import { Injectable, inject } from '@angular/core';

import { CartSummary } from '../models/cart.model';
import {
  AppliedDiscountCode,
  cartItemToOrderItem,
  CheckoutOrder,
  CustomerContact,
} from '../models/order.model';
import { generateOrderCode } from '../utils/order-code';
import { CampaignsService } from './campaigns.service';
import { ShopSettingsService } from './shop-settings.service';

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly campaignsService = inject(CampaignsService);
  private readonly shopSettingsService = inject(ShopSettingsService);

  buildOrder(
    summary: CartSummary,
    customer: CustomerContact,
    discount: AppliedDiscountCode | null,
  ): CheckoutOrder {
    const now = new Date();
    const subtotal = normalizeMoney(summary.subtotal);
    const discountAmount = normalizeMoney(discount?.amount ?? 0);
    const shipping = subtotal > 0 ? this.shopSettingsService.settingsSnapshot.shippingPrice : 0;

    return {
      id: generateOrderCode(),
      customer,
      items: summary.items.map((item) =>
        cartItemToOrderItem(item, this.campaignsService.activeCampaignsSnapshot),
      ),
      subtotal,
      discount: discount
        ? {
            code: discount.code,
            description: discount.description,
            amount: discountAmount,
          }
        : null,
      shipping: normalizeMoney(shipping),
      total: normalizeMoney(subtotal - discountAmount + shipping),
      paymentMethod: 'bizum',
      status: 'in_factory',
      createdAt: now,
      updatedAt: now,
    };
  }
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
