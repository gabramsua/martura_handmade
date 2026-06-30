import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, of } from 'rxjs';

import { MOCK_PRODUCTS, PRODUCT_CATEGORIES } from '../data/mock-products';
import { Product, ProductDraft, ProductFilters } from '../models/product.model';

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
  readonly products$ = this.productsSubject.asObservable();
  readonly filters$ = this.filtersSubject.asObservable();
  readonly categories$ = this.products$.pipe(
    map((products) =>
      Array.from(new Map(products.map((product) => [product.categorySlug, product.category])).entries()).map(
        ([slug, name]) => ({ slug, name }),
      ),
    ),
  );

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

  createProduct(draft: ProductDraft): void {
    const product = this.draftToProduct(draft);
    this.productsSubject.next([product, ...this.productsSubject.value]);
  }

  updateProduct(productId: string, draft: ProductDraft): void {
    this.productsSubject.next(
      this.productsSubject.value.map((product) =>
        product.id === productId
          ? {
              ...this.draftToProduct(draft, product),
              id: product.id,
              createdAt: product.createdAt,
            }
          : product,
      ),
    );
  }

  deleteProduct(productId: string): void {
    this.productsSubject.next(this.productsSubject.value.filter((product) => product.id !== productId));
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

  private draftToProduct(draft: ProductDraft, existingProduct?: Product): Product {
    const slug = draft.slug || this.slugify(draft.name);

    return {
      id: existingProduct?.id ?? `prd-${slug}-${Date.now()}`,
      name: draft.name,
      slug,
      description: draft.description,
      story: draft.story,
      originalPrice: draft.originalPrice,
      offerPrice: draft.offerPrice,
      imageUrl: draft.imageUrl,
      gallery: draft.gallery.length > 0 ? draft.gallery : [draft.imageUrl],
      category: draft.category,
      categorySlug: draft.categorySlug || this.slugify(draft.category),
      stock: draft.stock,
      sizes: draft.sizes,
      colors: draft.colors,
      campaignId: draft.campaignId,
      featured: draft.featured,
      createdAt: existingProduct?.createdAt ?? new Date(),
    };
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
