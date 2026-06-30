import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map, switchMap } from 'rxjs';

import { Product } from '../../core/models/product.model';
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
  private readonly productsService = inject(ProductsService);
  private readonly cartService = inject(CartService);

  readonly product$ = this.route.paramMap.pipe(
    map((params) => params.get('slug') ?? ''),
    switchMap((slug) => this.productsService.getProductBySlug(slug)),
  );

  addToCart(product: Product, variant: string): void {
    this.cartService.addItem(product, variant);
  }
}
