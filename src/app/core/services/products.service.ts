import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, of } from 'rxjs';

import { MOCK_PRODUCTS, PRODUCT_CATEGORIES } from '../data/mock-products';
import { Product, ProductFilters } from '../models/product.model';

const INITIAL_FILTERS: ProductFilters = {
  categorySlug: null,
  query: '',
  onlyOffers: false,
};

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly productsSubject = new BehaviorSubject<Product[]>(MOCK_PRODUCTS);
  private readonly filtersSubject = new BehaviorSubject<ProductFilters>(INITIAL_FILTERS);

  readonly loading$ = of(false);
  readonly categories$ = of(PRODUCT_CATEGORIES);
  readonly products$ = this.productsSubject.asObservable();
  readonly filters$ = this.filtersSubject.asObservable();

  readonly filteredProducts$ = combineLatest([this.products$, this.filters$]).pipe(
    map(([products, filters]) => this.applyFilters(products, filters)),
  );

  readonly featuredProducts$ = this.products$.pipe(
    map((products) => products.filter((product) => product.featured)),
  );

  updateFilters(partial: Partial<ProductFilters>): void {
    this.filtersSubject.next({ ...this.filtersSubject.value, ...partial });
  }

  clearFilters(): void {
    this.filtersSubject.next(INITIAL_FILTERS);
  }

  getProductBySlug(slug: string): Observable<Product | undefined> {
    return this.products$.pipe(
      map((products) => products.find((product) => product.slug === slug)),
    );
  }

  private applyFilters(products: Product[], filters: ProductFilters): Product[] {
    const query = filters.query.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory = !filters.categorySlug || product.categorySlug === filters.categorySlug;
      const matchesOffer = !filters.onlyOffers || product.offerPrice !== null;
      const matchesQuery =
        !query ||
        product.name.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);

      return matchesCategory && matchesOffer && matchesQuery;
    });
  }
}
