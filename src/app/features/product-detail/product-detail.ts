import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';

import { isProductAvailable, Product } from '../../core/models/product.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';
import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-product-detail',
  imports: [AsyncPipe, CurrencyPipe, RouterLink],
  templateUrl: './product-detail.html',
  styleUrl: './product-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly campaignsService = inject(CampaignsService);
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);

  readonly product$ = this.route.paramMap.pipe(
    map((params) => params.get('slug') ?? ''),
    switchMap((slug) => this.productsService.getProductBySlug(slug)),
    switchMap((product) => this.campaignsService.activeCampaigns$.pipe(map(() => product))),
  );

  addToCart(product: Product, variant: string): void {
    this.cartService.addItem(product, variant);
  }

  isAvailable(product: Product): boolean {
    return isProductAvailable(product);
  }

  getStatusLabel(product: Product): string {
    return product.status === 'sold_out' ? 'Agotado' : 'Disponible';
  }

  getCurrentPrice(product: Product): number {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }

  getComparePrice(product: Product): number | null {
    const pricing = resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot);
    return pricing.hasDiscount ? pricing.originalPrice : null;
  }

  getCampaignLabel(product: Product): string | null {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).campaignName;
  }

  getTaxonomyLabel(product: Product): string {
    return product.collection ? `${product.category} · ${product.collection}` : product.category;
  }
}
