import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  isProductAvailable,
  Product,
  ProductSort,
} from '../../core/models/product.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';
import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-home',
  imports: [AsyncPipe, CurrencyPipe, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly campaignsService = inject(CampaignsService);
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);

  readonly featuredProducts$ = this.productsService.featuredProducts$;
  readonly filteredProducts$ = this.productsService.filteredProducts$;
  readonly filters$ = this.productsService.filters$;
  readonly categories$ = this.productsService.categories$;
  readonly collections$ = this.productsService.collections$;
  readonly sortOptions: Array<{ value: ProductSort; label: string }> = [
    { value: 'newest', label: 'Novedades' },
    { value: 'price-asc', label: 'Precio ascendente' },
    { value: 'price-desc', label: 'Precio descendente' },
    { value: 'name', label: 'Nombre' },
  ];

  updateQuery(query: string): void {
    this.productsService.updateFilters({ query });
  }

  selectCategory(categorySlug: string | null): void {
    this.productsService.updateFilters({ categorySlug });
  }

  selectCollection(collectionSlug: string | null): void {
    this.productsService.updateFilters({ collectionSlug });
  }

  toggleOffers(onlyOffers: boolean): void {
    this.productsService.updateFilters({ onlyOffers });
  }

  sortCatalog(sortBy: ProductSort): void {
    this.productsService.updateFilters({ sortBy });
  }

  addToCart(product: Product): void {
    this.cartService.addItem(product);
  }

  isAvailable(product: Product): boolean {
    return isProductAvailable(product);
  }

  getBadgeLabel(product: Product): string | null {
    if (product.status === 'sold_out') {
      return 'Agotado';
    }

    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).badgeLabel;
  }

  getCurrentPrice(product: Product): number {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }

  getComparePrice(product: Product): number | null {
    const pricing = resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot);
    return pricing.hasDiscount ? pricing.originalPrice : null;
  }

  getTaxonomyLabel(product: Product): string {
    return product.collection ? `${product.category} · ${product.collection}` : product.category;
  }
}
