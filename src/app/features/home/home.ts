import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { Product } from '../../core/models/product.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { AlertsService } from '../../core/services/alerts.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { ProductsService } from '../../core/services/products.service';
import { ShopSettingsService } from '../../core/services/shop-settings.service';

@Component({
  selector: 'app-home',
  imports: [AsyncPipe, CurrencyPipe, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly destroyRef = inject(DestroyRef);
  private readonly alertsService = inject(AlertsService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly productsService = inject(ProductsService);
  private readonly shopSettingsService = inject(ShopSettingsService);

  readonly currentHeroIndex = signal(0);
  readonly featuredProducts$ = this.productsService.featuredProducts$;
  readonly heroSlides$ = this.shopSettingsService.heroSlides$;
  readonly heroSlides = toSignal(this.heroSlides$, { initialValue: [] });

  constructor() {
    const intervalId = window.setInterval(() => {
      const slides = this.heroSlides();

      if (slides.length <= 1) {
        return;
      }

      this.currentHeroIndex.update((index) => (index + 1) % slides.length);
    }, 5000);

    this.destroyRef.onDestroy(() => window.clearInterval(intervalId));
  }

  isCurrentSlide(index: number): boolean {
    const slides = this.heroSlides();

    if (!slides.length) {
      return false;
    }

    return this.currentHeroIndex() % slides.length === index;
  }

  goToSlide(index: number): void {
    this.currentHeroIndex.set(index);
  }

  previousHero(): void {
    const slides = this.heroSlides();

    if (!slides.length) {
      return;
    }

    this.currentHeroIndex.update((index) => (index - 1 + slides.length) % slides.length);
  }

  nextHero(): void {
    const slides = this.heroSlides();

    if (!slides.length) {
      return;
    }

    this.currentHeroIndex.update((index) => (index + 1) % slides.length);
  }

  async shareProduct(product: Product): Promise<void> {
    const shareUrl = new URL(`/producto/${product.slug}`, window.location.origin).toString();

    try {
      if (navigator.share) {
        await navigator.share({
          title: product.name,
          text: `${product.name} · Martura Handmade`,
          url: shareUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      this.alertsService.toast('success', 'Enlace copiado al portapapeles.');
    } catch {
      this.alertsService.toast('error', 'No se pudo compartir este producto.');
    }
  }

  getCurrentPrice(product: Product): number {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }

  getTaxonomyLabel(product: Product): string {
    return [product.category, product.subcategory, product.collection].filter(Boolean).join(' · ');
  }
}
