import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CartItem } from '../../core/models/cart.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';

@Component({
  selector: 'app-cart',
  imports: [AsyncPipe, CurrencyPipe, RouterLink],
  templateUrl: './cart.html',
  styleUrl: './cart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Cart {
  private readonly campaignsService = inject(CampaignsService);
  private readonly cartService = inject(CartService);

  readonly summary$ = this.cartService.summary$;

  updateQuantity(productId: string, variant: string, quantity: number): void {
    this.cartService.updateQuantity(productId, variant, quantity);
  }

  removeItem(productId: string, variant: string): void {
    this.cartService.removeItem(productId, variant);
  }

  getLineTotal(item: CartItem): number {
    return (
      resolveProductPricing(item.product, this.campaignsService.activeCampaignsSnapshot).effectivePrice *
      item.quantity
    );
  }

  getUnitPrice(item: CartItem): number {
    return resolveProductPricing(item.product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }
}
