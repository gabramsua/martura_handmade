import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';

import { Campaign } from '../../core/models/campaign.model';
import { isProductAvailable, Product } from '../../core/models/product.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { AuthService } from '../../core/services/auth.service';
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
  private readonly authService = inject(AuthService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);
  readonly selectedImageUrl = signal<string | null>(null);

  readonly isAdmin$ = this.authService.isAdmin$;
  readonly product$ = this.route.paramMap.pipe(
    map((params) => params.get('slug') ?? ''),
    switchMap((slug) => this.productsService.getProductBySlug(slug)),
    switchMap((product) => this.campaignsService.activeCampaigns$.pipe(map(() => product))),
  );

  addToCart(product: Product, variant: string): void {
    this.cartService.addItem(product, variant);
  }

  selectImage(imageUrl: string): void {
    this.selectedImageUrl.set(imageUrl);
  }

  isAvailable(product: Product): boolean {
    return isProductAvailable(product);
  }

  getMainImage(product: Product): string {
    const selectedImageUrl = this.selectedImageUrl();

    if (selectedImageUrl && product.gallery.includes(selectedImageUrl)) {
      return selectedImageUrl;
    }

    return product.imageUrl;
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

  getCampaignSummary(product: Product): string | null {
    const campaign = this.getResolvedCampaign(product);

    if (!campaign) {
      return null;
    }

    const campaignWindow = this.getCampaignWindow(campaign);
    return campaignWindow ? `${campaign.name} · ${campaignWindow}` : campaign.name;
  }

  getTaxonomyLabel(product: Product): string {
    return product.collection ? `${product.category} - ${product.collection}` : product.category;
  }

  private getResolvedCampaign(product: Product): Campaign | null {
    const pricing = resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot);

    if (pricing.source !== 'campaign' || !pricing.campaignId) {
      return null;
    }

    return this.campaignsService.getCampaignById(pricing.campaignId);
  }

  private getCampaignWindow(campaign: Campaign): string | null {
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
