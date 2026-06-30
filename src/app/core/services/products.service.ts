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
import { Product, ProductDraft, ProductFilters } from '../models/product.model';
import { CartItem } from '../models/cart.model';
import { OrderItem } from '../models/order.model';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveProduct } from '../firebase/firestore.mappers';
import { LocalStorageService } from './local-storage.service';

const INITIAL_FILTERS: ProductFilters = {
  categorySlug: null,
  query: '',
  onlyOffers: false,
};
const PRODUCTS_STORAGE_KEY = 'martura_products';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly firestore = inject(Firestore, { optional: true });
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

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    const productsCollection = collection(this.firestore, firestoreCollections.products);
    const productsQuery = query(productsCollection, orderBy('createdAt', 'desc'));

    collectionData(productsQuery, { idField: 'id' }).subscribe({
      next: (products) => {
        this.productsSubject.next(
          (products as Array<Product & { createdAt: unknown }>).map((product) =>
            reviveProduct(product),
          ),
        );
        this.loadingSubject.next(false);
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
      map((products) => products.find((product) => product.slug === slug)),
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
    const orderedQuantityByProduct = orderItems.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.productId] = (accumulator[item.productId] ?? 0) + item.quantity;
      return accumulator;
    }, {});

    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of this.productsSubject.value) {
        const orderedQuantity = orderedQuantityByProduct[product.id] ?? 0;

        if (!orderedQuantity) {
          continue;
        }

        batch.set(
          this.getProductDoc(product.id),
          {
            ...product,
            stock: Math.max(0, product.stock - orderedQuantity),
          },
        );
      }

      await batch.commit();
      return;
    }

    this.setProducts(
      this.productsSubject.value.map((product) => ({
        ...product,
        stock: Math.max(0, product.stock - (orderedQuantityByProduct[product.id] ?? 0)),
      })),
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

  private setProducts(products: Product[]): void {
    this.productsSubject.next(products);
    this.localStorageService.write(PRODUCTS_STORAGE_KEY, products);
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
}
