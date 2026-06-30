import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CartService } from '../../core/services/cart.service';
import { ProductsService } from '../../core/services/products.service';
import { Product } from '../../core/models/product.model';

@Component({
  selector: 'app-home',
  imports: [AsyncPipe, CurrencyPipe, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);

  readonly featuredProducts$ = this.productsService.featuredProducts$;
  readonly filteredProducts$ = this.productsService.filteredProducts$;
  readonly filters$ = this.productsService.filters$;
  readonly categories$ = this.productsService.categories$;

  updateQuery(query: string): void {
    this.productsService.updateFilters({ query });
  }

  selectCategory(categorySlug: string | null): void {
    this.productsService.updateFilters({ categorySlug });
  }

  toggleOffers(onlyOffers: boolean): void {
    this.productsService.updateFilters({ onlyOffers });
  }

  addToCart(product: Product): void {
    this.cartService.addItem(product);
  }
}
