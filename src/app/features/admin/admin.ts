import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { map } from 'rxjs';

import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-admin',
  imports: [AsyncPipe, CurrencyPipe],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly productsService = inject(ProductsService);

  readonly products$ = this.productsService.products$;
  readonly stats$ = this.products$.pipe(
    map((products) => {
      const lowStock = products.filter((product) => product.stock <= 4).length;
      const inventoryValue = products.reduce(
        (total, product) => total + (product.offerPrice ?? product.originalPrice) * product.stock,
        0,
      );

      return {
        products: products.length,
        lowStock,
        inventoryValue,
        pendingOrders: 3,
      };
    }),
  );
}
