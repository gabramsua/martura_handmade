import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';

import { Campaign } from '../../core/models/campaign.model';
import {
  isProductAvailable,
  isProductVisible,
  Product,
  ProductFilters,
  ProductSort,
} from '../../core/models/product.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { AuthService } from '../../core/services/auth.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CartService } from '../../core/services/cart.service';
import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-home',
  imports: [AsyncPipe, CurrencyPipe, MatProgressBarModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly authService = inject(AuthService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);

  readonly loading$ = this.productsService.loading$;
  readonly featuredProducts$ = this.productsService.featuredProducts$;
  readonly filteredProducts$ = this.productsService.filteredProducts$;
  readonly filteredCount$ = this.filteredProducts$.pipe(map((products) => products.length));
  readonly filters$ = this.productsService.filters$;
  readonly categories$ = this.productsService.categories$;
  readonly catalogCount$ = this.productsService.products$.pipe(
    map((products) => products.filter((product) => isProductVisible(product)).length),
  );
  readonly collections$ = this.productsService.collections$;
  readonly isAdmin$ = this.authService.isAdmin$;
  readonly showAdminAccess$ = this.authService.user$.pipe(map((user) => !user || user.role === 'admin'));
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

  clearFilters(): void {
    this.productsService.clearFilters();
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

  getCampaignSummary(product: Product): string | null {
    const campaign = this.getResolvedCampaign(product);

    if (!campaign) {
      return null;
    }

    const scheduleLabel = this.getCampaignScheduleLabel(campaign);
    return scheduleLabel ? `${campaign.name} · ${scheduleLabel}` : campaign.name;
  }

  getTaxonomyLabel(product: Product): string {
    return product.collection ? `${product.category} - ${product.collection}` : product.category;
  }

  hasActiveFilters(filters: ProductFilters): boolean {
    return !!filters.query.trim() || !!filters.categorySlug || !!filters.collectionSlug || filters.onlyOffers;
  }

  private getResolvedCampaign(product: Product): Campaign | null {
    const pricing = resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot);

    if (pricing.source !== 'campaign' || !pricing.campaignId) {
      return null;
    }

    return this.campaignsService.getCampaignById(pricing.campaignId);
  }

  private getCampaignScheduleLabel(campaign: Campaign): string | null {
    if (campaign.startsAt && campaign.endsAt) {
      return `${this.formatShortDate(campaign.startsAt)} - ${this.formatShortDate(campaign.endsAt)}`;
    }

    if (campaign.endsAt) {
      return `Hasta ${this.formatShortDate(campaign.endsAt)}`;
    }

    if (campaign.startsAt) {
      return `Desde ${this.formatShortDate(campaign.startsAt)}`;
    }

    return null;
  }

  private formatShortDate(value: Date): string {
    return new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'short',
    }).format(value);
  }
}
