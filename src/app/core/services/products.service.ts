import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';

import { MOCK_PRODUCTS } from '../data/mock-products';
import {
  isProductAvailable,
  isProductVisible,
  normalizePricingMode,
  normalizeProductStatus,
  Product,
  ProductDraft,
  ProductFilters,
  ProductSort,
} from '../models/product.model';
import { CartItem } from '../models/cart.model';
import { OrderItem } from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveProduct } from '../firebase/firestore.mappers';
import { resolveProductPricing } from '../utils/product-pricing';
import { CampaignsService } from './campaigns.service';
import { LocalStorageService } from './local-storage.service';

const INITIAL_FILTERS: ProductFilters = {
  categorySlug: null,
  collectionSlug: null,
  query: '',
  onlyOffers: false,
  sortBy: 'newest',
};
const PRODUCTS_STORAGE_KEY = 'martura_products';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly campaignsService = inject(CampaignsService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly productsSubject = new BehaviorSubject<Product[]>(
    this.readInitialProducts(),
  );
  private readonly filtersSubject = new BehaviorSubject<ProductFilters>(INITIAL_FILTERS);
  private readonly loadingSubject = new BehaviorSubject<boolean>(
    isFirebaseConfigured && !!this.firestore,
  );

  readonly loading$ = this.loadingSubject.asObservable();
  readonly products$ = this.productsSubject.asObservable();
  readonly filters$ = this.filtersSubject.asObservable();
  readonly categories$ = this.products$.pipe(
    map((products) =>
      Array.from(
        new Map(
          this.getPublicCatalogProducts(products).map((product) => [product.categorySlug, product.category]),
        ).entries(),
      )
        .map(([slug, name]) => ({ slug, name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'es')),
    ),
  );
  readonly collections$ = this.products$.pipe(
    map((products) =>
      Array.from(
        new Map(
          this.getPublicCatalogProducts(products)
            .filter(
              (product): product is Product & { collection: string; collectionSlug: string } =>
                !!product.collectionSlug && !!product.collection,
            )
            .map((product) => [product.collectionSlug, product.collection] as const),
        ).entries(),
      )
        .map(([slug, name]) => ({ slug, name }))
        .sort((left, right) => left.name.localeCompare(right.name, 'es')),
    ),
  );

  readonly filteredProducts$ = combineLatest([
    this.products$,
    this.filters$,
    this.campaignsService.activeCampaigns$,
  ]).pipe(
    map(([products, filters]) => this.applyFilters(this.getPublicCatalogProducts(products), filters)),
  );

  readonly featuredProducts$ = combineLatest([
    this.products$,
    this.campaignsService.activeCampaigns$,
  ]).pipe(
    map(([products]) =>
      this.sortProducts(
        products.filter((product) => product.featured && isProductAvailable(product)),
        'newest',
      ),
    ),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    const productsCollection = collection(this.firestore, firestoreCollections.products);
    const productsQuery = query(productsCollection, orderBy('createdAt', 'desc'));

    collectionData(productsQuery, { idField: 'id' }).subscribe({
      next: (products) => {
        const nextProducts = (products as Array<Product & { createdAt: unknown }>).map((product) =>
          reviveProduct(product),
        );

        this.productsSubject.next(nextProducts);
        this.loadingSubject.next(false);

        if (nextProducts.length === 0) {
          void this.seedProductsIfEmpty();
        }
      },
      error: () => {
        this.loadingSubject.next(false);
      },
    });
  }

  updateFilters(partial: Partial<ProductFilters>): void {
    this.filtersSubject.next({ ...this.filtersSubject.value, ...partial });
  }

  clearFilters(): void {
    this.filtersSubject.next(INITIAL_FILTERS);
  }

  getProductBySlug(slug: string): Observable<Product | undefined> {
    return this.products$.pipe(
      map((products) => products.find((product) => product.slug === slug && isProductVisible(product))),
    );
  }

  validateCartItems(items: CartItem[]): { valid: boolean; message: string | null } {
    for (const item of items) {
      const product = this.productsSubject.value.find((entry) => entry.id === item.product.id);

      if (!product) {
        return {
          valid: false,
          message: `La pieza "${item.product.name}" ya no esta disponible.`,
        };
      }

      if (!isProductVisible(product)) {
        return {
          valid: false,
          message: `La pieza "${product.name}" ya no esta visible en tienda.`,
        };
      }

      if (!isProductAvailable(product)) {
        return {
          valid: false,
          message: `La pieza "${product.name}" esta agotada en este momento.`,
        };
      }

      if (product.stock < item.quantity) {
        return {
          valid: false,
          message: `Solo quedan ${product.stock} unidades de "${product.name}".`,
        };
      }
    }

    return { valid: true, message: null };
  }

  async createProduct(draft: ProductDraft): Promise<void> {
    const product = this.draftToProduct(draft);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getProductDoc(product.id), product);
      return;
    }

    this.setProducts([product, ...this.productsSubject.value]);
  }

  async updateProduct(productId: string, draft: ProductDraft): Promise<void> {
    const updatedProduct = this.productsSubject.value.find((product) => product.id === productId);

    if (!updatedProduct) {
      return;
    }

    const nextProduct = {
      ...this.draftToProduct(draft, updatedProduct),
      id: updatedProduct.id,
      createdAt: updatedProduct.createdAt,
    };

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getProductDoc(productId), nextProduct);
      return;
    }

    this.setProducts(
      this.productsSubject.value.map((product) =>
        product.id === productId
          ? nextProduct
          : product,
      ),
    );
  }

  async deleteProduct(productId: string): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await deleteDoc(this.getProductDoc(productId));
      return;
    }

    this.setProducts(this.productsSubject.value.filter((product) => product.id !== productId));
  }

  async resetProducts(): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of this.productsSubject.value) {
        batch.delete(this.getProductDoc(product.id));
      }

      for (const product of MOCK_PRODUCTS) {
        batch.set(this.getProductDoc(product.id), product);
      }

      await batch.commit();
      return;
    }

    this.setProducts(MOCK_PRODUCTS);
  }

  async applyOrder(orderItems: OrderItem[]): Promise<void> {
    await this.reserveOrder(orderItems);
  }

  validateOrderItems(orderItems: OrderItem[]): { valid: boolean; message: string | null } {
    for (const item of orderItems) {
      const product = this.productsSubject.value.find((entry) => entry.id === item.productId);

      if (!product) {
        return {
          valid: false,
          message: `La pieza "${item.productName}" ya no esta disponible.`,
        };
      }

      if (!isProductVisible(product)) {
        return {
          valid: false,
          message: `La pieza "${product.name}" ya no esta visible en tienda.`,
        };
      }

      if (!isProductAvailable(product)) {
        return {
          valid: false,
          message: `La pieza "${product.name}" esta agotada en este momento.`,
        };
      }

      if (product.stock < item.quantity) {
        return {
          valid: false,
          message: `Solo quedan ${product.stock} unidades de "${product.name}".`,
        };
      }
    }

    return { valid: true, message: null };
  }

  async reserveOrder(orderItems: OrderItem[]): Promise<void> {
    const stockValidation = this.validateOrderItems(orderItems);

    if (!stockValidation.valid) {
      throw new Error(stockValidation.message ?? 'No se pudo reservar el stock del pedido.');
    }

    await this.adjustInventory(orderItems, 'reserve');
  }

  async releaseOrder(orderItems: OrderItem[]): Promise<void> {
    await this.adjustInventory(orderItems, 'release');
  }

  private async adjustInventory(orderItems: OrderItem[], operation: 'reserve' | 'release'): Promise<void> {
    const orderedQuantityByProduct = orderItems.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.productId] = (accumulator[item.productId] ?? 0) + item.quantity;
      return accumulator;
    }, {});

    const nextProducts = this.productsSubject.value.map((product) => {
      const quantity = orderedQuantityByProduct[product.id] ?? 0;

      if (!quantity) {
        return product;
      }

      const nextStock = operation === 'reserve'
        ? Math.max(0, product.stock - quantity)
        : product.stock + quantity;

      return {
        ...product,
        stock: nextStock,
        status: normalizeProductStatus(product.status, nextStock),
      };
    });

    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of nextProducts) {
        const orderedQuantity = orderedQuantityByProduct[product.id] ?? 0;

        if (!orderedQuantity) {
          continue;
        }

        batch.set(
          this.getProductDoc(product.id),
          product,
        );
      }

      await batch.commit();
      return;
    }

    this.setProducts(nextProducts);
  }

  private applyFilters(products: Product[], filters: ProductFilters): Product[] {
    const query = filters.query.trim().toLowerCase();

    return this.sortProducts(
      products.filter((product) => {
        const matchesCategory = !filters.categorySlug || product.categorySlug === filters.categorySlug;
        const matchesCollection =
          !filters.collectionSlug || product.collectionSlug === filters.collectionSlug;
        const matchesOffer =
          !filters.onlyOffers ||
          resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).hasDiscount;
        const matchesQuery =
          !query ||
          product.name.toLowerCase().includes(query) ||
          product.description.toLowerCase().includes(query) ||
          product.category.toLowerCase().includes(query) ||
          (product.collection ?? '').toLowerCase().includes(query);

        return matchesCategory && matchesCollection && matchesOffer && matchesQuery;
      }),
      filters.sortBy,
    );
  }

  private draftToProduct(draft: ProductDraft, existingProduct?: Product): Product {
    const slug = draft.slug || this.slugify(draft.name);
    const normalizedStatus = normalizeProductStatus(draft.status, draft.stock);

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
      collection: draft.collection,
      collectionSlug: draft.collectionSlug,
      stock: draft.stock,
      sizes: draft.sizes,
      colors: draft.colors,
      pricingMode: normalizePricingMode(draft),
      campaignId: draft.campaignId,
      featured: draft.featured,
      status: normalizedStatus,
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

  private setProducts(products: Product[]): void {
    this.productsSubject.next(products);
    this.localStorageService.write(PRODUCTS_STORAGE_KEY, products);
  }

  private getPublicCatalogProducts(products: Product[]): Product[] {
    return products.filter((product) => isProductVisible(product));
  }

  private sortProducts(products: Product[], sortBy: ProductSort): Product[] {
    const nextProducts = [...products];

    nextProducts.sort((left, right) => {
      switch (sortBy) {
        case 'price-asc':
          return this.getEffectivePrice(left) - this.getEffectivePrice(right);
        case 'price-desc':
          return this.getEffectivePrice(right) - this.getEffectivePrice(left);
        case 'name':
          return left.name.localeCompare(right.name, 'es');
        case 'newest':
        default:
          return right.createdAt.getTime() - left.createdAt.getTime();
      }
    });

    return nextProducts;
  }

  private getEffectivePrice(product: Product): number {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }

  private readInitialProducts(): Product[] {
    if (isFirebaseConfigured) {
      return [];
    }

    return this.localStorageService.read(PRODUCTS_STORAGE_KEY, MOCK_PRODUCTS, (products) =>
      (products as Array<Product & { createdAt: unknown }>).map((product) => reviveProduct(product)),
    );
  }

  private getProductDoc(productId: string) {
    return doc(this.firestore!, firestoreCollections.products, productId);
  }

  private async seedProductsIfEmpty(): Promise<void> {
    if (!this.firestore || this.productsSubject.value.length > 0) {
      return;
    }

    const batch = writeBatch(this.firestore);

    for (const product of MOCK_PRODUCTS) {
      batch.set(this.getProductDoc(product.id), product);
    }

    await batch.commit();
  }
}
