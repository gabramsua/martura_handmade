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
  getProductCategoryNames,
  getProductCategorySlugs,
  getProductCollectionNames,
  getProductCollectionSlugs,
  getProductSubcategoryNames,
  getProductSubcategorySlugs,
  isProductAvailable,
  isProductVisible,
  normalizePricingMode,
  normalizeProductCampaignIds,
  normalizeProductStatus,
  Product,
  ProductDraft,
  ProductFilters,
  ProductSort,
} from '../models/product.model';
import { CartItem } from '../models/cart.model';
import { OrderItem } from '../models/order.model';
import { TaxonomyType } from '../models/taxonomy.model';
import {
  firestoreCollections,
  isFirebaseConfigured,
  isUsingFirebaseEmulators,
} from '../firebase/firebase.config';
import { reviveProduct } from '../firebase/firestore.mappers';
import { resolveProductPricing } from '../utils/product-pricing';
import { buildUniqueSlug, slugify } from '../utils/slug';
import { CampaignsService } from './campaigns.service';
import { LocalStorageService } from './local-storage.service';
import { MediaService } from './media.service';
import { TaxonomiesService } from './taxonomies.service';

const INITIAL_FILTERS: ProductFilters = {
  categorySlug: null,
  subcategorySlug: null,
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
  private readonly mediaService = inject(MediaService);
  private readonly taxonomiesService = inject(TaxonomiesService);
  private readonly productsSubject = new BehaviorSubject<Product[]>(
    this.readInitialProducts(),
  );
  private readonly filtersSubject = new BehaviorSubject<ProductFilters>(INITIAL_FILTERS);
  private readonly loadingSubject = new BehaviorSubject<boolean>(
    isFirebaseConfigured && !!this.firestore,
  );
  private hasRequestedDemoSeed = false;

  readonly loading$ = this.loadingSubject.asObservable();
  readonly products$ = this.productsSubject.asObservable();
  readonly filters$ = this.filtersSubject.asObservable();
  readonly categories$ = combineLatest([this.taxonomiesService.categories$, this.products$]).pipe(
    map(([taxonomies, products]) =>
      this.mergeCatalogTaxonomies(
        taxonomies,
        this.getPublicCatalogProducts(products).flatMap((product) =>
          getProductCategorySlugs(product).map((slug, index) => ({
            slug,
            name: getProductCategoryNames(product)[index] ?? product.category,
          })),
        ),
      ),
    ),
  );
  readonly subcategories$ = combineLatest([this.taxonomiesService.subcategories$, this.products$]).pipe(
    map(([taxonomies, products]) =>
      this.mergeCatalogTaxonomies(
        taxonomies,
        this.getPublicCatalogProducts(products).flatMap((product) =>
          getProductSubcategorySlugs(product).map((slug, index) => ({
            slug,
            name: getProductSubcategoryNames(product)[index] ?? product.subcategory ?? '',
          })),
        ),
      ),
    ),
  );
  readonly collections$ = combineLatest([this.taxonomiesService.collections$, this.products$]).pipe(
    map(([taxonomies, products]) =>
      this.mergeCatalogTaxonomies(
        taxonomies,
        this.getPublicCatalogProducts(products).flatMap((product) =>
          getProductCollectionSlugs(product).map((slug, index) => ({
            slug,
            name: getProductCollectionNames(product)[index] ?? product.collection ?? '',
          })),
        ),
      ),
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
        const nextProducts = this.sortStoredProducts(
          (products as Array<Product & { createdAt: unknown }>).map((product) => reviveProduct(product)),
        );

        if (nextProducts.length === 0 && isUsingFirebaseEmulators && !this.hasRequestedDemoSeed) {
          this.hasRequestedDemoSeed = true;
          this.loadingSubject.next(true);
          void this.seedDemoCatalog();
          return;
        }

        this.productsSubject.next(nextProducts);
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

  get productsSnapshot(): Product[] {
    return this.productsSubject.value;
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

    this.setProducts([...this.productsSubject.value, product]);
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
    const removedGalleryUrls = this.getRemovedGalleryUrls(updatedProduct, nextProduct);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getProductDoc(productId), nextProduct);
      await this.mediaService.deleteProductImages(removedGalleryUrls);
      return;
    }

    this.setProducts(
      this.productsSubject.value.map((product) =>
        product.id === productId
          ? nextProduct
          : product,
      ),
    );
    await this.mediaService.deleteProductImages(removedGalleryUrls);
  }

  async deleteProduct(productId: string): Promise<void> {
    const product = this.productsSubject.value.find((entry) => entry.id === productId);

    if (isFirebaseConfigured && this.firestore) {
      await deleteDoc(this.getProductDoc(productId));
      await this.mediaService.deleteProductImages(product?.gallery ?? []);
      return;
    }

    this.setProducts(this.productsSubject.value.filter((product) => product.id !== productId));
    await this.mediaService.deleteProductImages(product?.gallery ?? []);
  }

  async replaceTaxonomyReference(
    type: TaxonomyType,
    previousSlug: string,
    nextValue: { name: string; slug: string },
  ): Promise<void> {
    const impactedProducts = this.productsSubject.value.filter((product) =>
      type === 'category'
        ? getProductCategorySlugs(product).includes(previousSlug)
        : type === 'subcategory'
          ? getProductSubcategorySlugs(product).includes(previousSlug)
          : getProductCollectionSlugs(product).includes(previousSlug),
    );

    if (!impactedProducts.length) {
      return;
    }

    const nextProducts = this.productsSubject.value.map((product) => {
      const currentNames = type === 'category'
        ? getProductCategoryNames(product)
        : type === 'subcategory'
          ? getProductSubcategoryNames(product)
          : getProductCollectionNames(product);
      const currentSlugs = type === 'category'
        ? getProductCategorySlugs(product)
        : type === 'subcategory'
          ? getProductSubcategorySlugs(product)
          : getProductCollectionSlugs(product);
      const matchesTaxonomy = currentSlugs.includes(previousSlug);

      if (!matchesTaxonomy) {
        return product;
      }

      const nextNames = currentNames.map((name, index) =>
        currentSlugs[index] === previousSlug ? nextValue.name : name,
      );
      const nextSlugs = currentSlugs.map((slug) => (slug === previousSlug ? nextValue.slug : slug));

      if (type === 'category') {
        return {
          ...product,
          category: nextNames[0] ?? product.category,
          categorySlug: nextSlugs[0] ?? product.categorySlug,
          categories: nextNames,
          categorySlugs: nextSlugs,
        };
      }

      if (type === 'subcategory') {
        return {
          ...product,
          subcategory: nextNames[0] ?? null,
          subcategorySlug: nextSlugs[0] ?? null,
          subcategories: nextNames,
          subcategorySlugs: nextSlugs,
        };
      }

      return {
        ...product,
        collection: nextNames[0] ?? null,
        collectionSlug: nextSlugs[0] ?? null,
        collections: nextNames,
        collectionSlugs: nextSlugs,
      };
    });

    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of nextProducts) {
        const matchesTaxonomy = type === 'category'
          ? getProductCategorySlugs(product).includes(nextValue.slug)
          : type === 'subcategory'
            ? getProductSubcategorySlugs(product).includes(nextValue.slug)
            : getProductCollectionSlugs(product).includes(nextValue.slug);

        if (!matchesTaxonomy) {
          continue;
        }

        batch.set(this.getProductDoc(product.id), product);
      }

      await batch.commit();
      return;
    }

    this.setProducts(nextProducts);
  }

  async resetProducts(): Promise<void> {
    const galleryUrls = this.productsSubject.value.flatMap((product) => product.gallery);

    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of this.productsSubject.value) {
        batch.delete(this.getProductDoc(product.id));
      }

      for (const product of MOCK_PRODUCTS) {
        batch.set(this.getProductDoc(product.id), product);
      }

      await batch.commit();
      await this.mediaService.deleteProductImages(galleryUrls);
      return;
    }

    this.setProducts(MOCK_PRODUCTS);
    await this.mediaService.deleteProductImages(galleryUrls);
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

  async syncCampaignAssignments(
    campaignId: string,
    productIds: string[],
    options?: { promoteToCampaign?: boolean },
  ): Promise<void> {
    const targetProductIds = new Set(productIds);
    const nextProducts = this.productsSubject.value.map((product) => {
      const currentCampaignIds = normalizeProductCampaignIds(product);
      const hadCampaign = currentCampaignIds.includes(campaignId);
      const shouldHaveCampaign = targetProductIds.has(product.id);
      const nextCampaignIds = shouldHaveCampaign
        ? Array.from(new Set([...currentCampaignIds, campaignId]))
        : currentCampaignIds.filter((currentId) => currentId !== campaignId);

      let pricingMode = product.pricingMode;

      if (shouldHaveCampaign && options?.promoteToCampaign) {
        pricingMode = 'campaign';
      } else if (
        hadCampaign &&
        !shouldHaveCampaign &&
        product.pricingMode === 'campaign' &&
        nextCampaignIds.length === 0
      ) {
        pricingMode = product.offerPrice !== null ? 'individual_offer' : 'regular';
      }

      return {
        ...product,
        pricingMode,
        campaignIds: nextCampaignIds,
      };
    });

    await this.persistProducts(nextProducts);
  }

  async removeCampaignFromAllProducts(campaignId: string): Promise<void> {
    await this.syncCampaignAssignments(campaignId, []);
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
        const matchesCategory =
          !filters.categorySlug || getProductCategorySlugs(product).includes(filters.categorySlug);
        const matchesSubcategory =
          !filters.subcategorySlug || getProductSubcategorySlugs(product).includes(filters.subcategorySlug);
        const matchesCollection =
          !filters.collectionSlug || getProductCollectionSlugs(product).includes(filters.collectionSlug);
        const matchesOffer =
          !filters.onlyOffers ||
          resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).hasDiscount;
        const matchesQuery =
          !query ||
          product.name.toLowerCase().includes(query) ||
          product.description.toLowerCase().includes(query) ||
          getProductCategoryNames(product).some((name) => name.toLowerCase().includes(query)) ||
          getProductSubcategoryNames(product).some((name) => name.toLowerCase().includes(query)) ||
          getProductCollectionNames(product).some((name) => name.toLowerCase().includes(query));

        return matchesCategory && matchesSubcategory && matchesCollection && matchesOffer && matchesQuery;
      }),
      filters.sortBy,
    );
  }

  private draftToProduct(draft: ProductDraft, existingProduct?: Product): Product {
    const gallery = Array.from(new Set(draft.gallery.map((image) => image.trim()).filter(Boolean)));
    const imageUrl = gallery[0] ?? draft.imageUrl.trim();
    const slug = this.buildProductSlug(draft.slug || draft.name, existingProduct?.id);
    const normalizedStatus = normalizeProductStatus(draft.status, draft.stock);
    const categoryNames = Array.from(
      new Set(
        Array.isArray(draft.categories)
          ? draft.categories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );
    const categorySlugs = Array.from(
      new Set(
        Array.isArray(draft.categorySlugs)
          ? draft.categorySlugs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );
    const subcategoryNames = Array.from(
      new Set(
        Array.isArray(draft.subcategories)
          ? draft.subcategories.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );
    const subcategorySlugs = Array.from(
      new Set(
        Array.isArray(draft.subcategorySlugs)
          ? draft.subcategorySlugs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );
    const collectionNames = Array.from(
      new Set(
        Array.isArray(draft.collections)
          ? draft.collections.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );
    const collectionSlugs = Array.from(
      new Set(
        Array.isArray(draft.collectionSlugs)
          ? draft.collectionSlugs.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : [],
      ),
    );

    return {
      id: existingProduct?.id ?? `prd-${slug}-${Date.now()}`,
      name: draft.name,
      slug,
      position: this.normalizePosition(draft.position, existingProduct?.position),
      description: draft.description,
      story: draft.story,
      originalPrice: draft.originalPrice,
      offerPrice: draft.offerPrice,
      imageUrl,
      gallery,
      category: categoryNames[0] ?? draft.category,
      categorySlug: categorySlugs[0] ?? draft.categorySlug,
      categories: categoryNames,
      categorySlugs,
      subcategory: subcategoryNames[0] ?? null,
      subcategorySlug: subcategorySlugs[0] ?? null,
      subcategories: subcategoryNames,
      subcategorySlugs,
      collection: collectionNames[0] ?? null,
      collectionSlug: collectionSlugs[0] ?? null,
      collections: collectionNames,
      collectionSlugs,
      stock: draft.stock,
      sizes: draft.sizes,
      colors: draft.colors,
      pricingMode: normalizePricingMode(draft),
      campaignIds: normalizeProductCampaignIds(draft),
      featured: draft.featured,
      status: normalizedStatus,
      createdAt: existingProduct?.createdAt ?? new Date(),
    };
  }

  private setProducts(products: Product[]): void {
    const nextProducts = this.sortStoredProducts(products);
    this.productsSubject.next(nextProducts);
    this.localStorageService.write(PRODUCTS_STORAGE_KEY, nextProducts);
  }

  private async persistProducts(products: Product[]): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const product of products) {
        batch.set(this.getProductDoc(product.id), product);
      }

      await batch.commit();
      return;
    }

    this.setProducts(products);
  }

  private getPublicCatalogProducts(products: Product[]): Product[] {
    return products.filter((product) => isProductVisible(product));
  }

  private sortProducts(products: Product[], sortBy: ProductSort): Product[] {
    const nextProducts = [...products];

    nextProducts.sort((left, right) => {
      switch (sortBy) {
        case 'price-asc':
          return (
            this.getEffectivePrice(left) - this.getEffectivePrice(right) ||
            this.compareCatalogPriority(left, right)
          );
        case 'price-desc':
          return (
            this.getEffectivePrice(right) - this.getEffectivePrice(left) ||
            this.compareCatalogPriority(left, right)
          );
        case 'name':
          return left.name.localeCompare(right.name, 'es') || this.compareCatalogPriority(left, right);
        case 'newest':
        default:
          return this.compareCatalogPriority(left, right);
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

    return this.sortStoredProducts(
      this.localStorageService.read(PRODUCTS_STORAGE_KEY, MOCK_PRODUCTS, (products) =>
        (products as Array<Product & { createdAt: unknown }>).map((product) => reviveProduct(product)),
      ),
    );
  }

  private getProductDoc(productId: string) {
    return doc(this.firestore!, firestoreCollections.products, productId);
  }

  private async seedDemoCatalog(): Promise<void> {
    if (!this.firestore) {
      this.loadingSubject.next(false);
      return;
    }

    try {
      const batch = writeBatch(this.firestore);

      for (const product of MOCK_PRODUCTS) {
        batch.set(this.getProductDoc(product.id), product);
      }

      await batch.commit();
    } catch {
      this.loadingSubject.next(false);
    }
  }

  private sortStoredProducts(products: Product[]): Product[] {
    return [...products].sort((left, right) => this.compareCatalogPriority(left, right));
  }

  private compareCatalogPriority(left: Product, right: Product): number {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  }

  private buildProductSlug(value: string, currentProductId?: string): string {
    const usedSlugs = this.productsSubject.value
      .filter((product) => product.id !== currentProductId)
      .map((product) => product.slug);

    return buildUniqueSlug(value, usedSlugs, 'producto');
  }

  private normalizePosition(value: number | undefined, fallback?: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }

    if (typeof fallback === 'number' && Number.isFinite(fallback)) {
      return Math.max(0, Math.round(fallback));
    }

    return this.getNextProductPosition();
  }

  private getNextProductPosition(): number {
    if (!this.productsSubject.value.length) {
      return 10;
    }

    return Math.max(...this.productsSubject.value.map((product) => product.position || 0)) + 10;
  }

  private getRemovedGalleryUrls(currentProduct: Product, nextProduct: Product): string[] {
    const nextGallery = new Set(nextProduct.gallery);
    return currentProduct.gallery.filter((imageUrl) => !nextGallery.has(imageUrl));
  }

  private mergeCatalogTaxonomies(
    taxonomies: Array<{ slug: string; name: string; position?: number }>,
    catalogEntries: Array<{ slug: string; name: string }>,
  ): Array<{ slug: string; name: string }> {
    const entries = new Map<string, { slug: string; name: string; position: number }>();

    for (const taxonomy of taxonomies) {
      entries.set(taxonomy.slug, {
        slug: taxonomy.slug,
        name: taxonomy.name,
        position: typeof taxonomy.position === 'number' ? taxonomy.position : 0,
      });
    }

    for (const entry of catalogEntries) {
      if (entries.has(entry.slug)) {
        continue;
      }

      entries.set(entry.slug, {
        ...entry,
        position: Number.MAX_SAFE_INTEGER,
      });
    }

    return Array.from(entries.values())
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }

        return left.name.localeCompare(right.name, 'es');
      })
      .map(({ slug, name }) => ({ slug, name }));
  }

}
