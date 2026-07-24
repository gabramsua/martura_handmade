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
import { BehaviorSubject, combineLatest, map } from 'rxjs';

import { MOCK_PRODUCTS } from '../data/mock-products';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveTaxonomy } from '../firebase/firestore.mappers';
import { Product } from '../models/product.model';
import { CatalogTaxonomy, SerializedCatalogTaxonomy, TaxonomyDraft, TaxonomyType } from '../models/taxonomy.model';
import { slugify } from '../utils/slug';
import { LocalStorageService } from './local-storage.service';

const CATEGORY_STORAGE_KEY = 'martura_taxonomy_categories';
const SUBCATEGORY_STORAGE_KEY = 'martura_taxonomy_subcategories';
const COLLECTION_STORAGE_KEY = 'martura_taxonomy_collections';

@Injectable({ providedIn: 'root' })
export class TaxonomiesService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly categoriesSubject = new BehaviorSubject<CatalogTaxonomy[]>(
    this.readInitialTaxonomies('category'),
  );
  private readonly collectionsSubject = new BehaviorSubject<CatalogTaxonomy[]>(
    this.readInitialTaxonomies('collection'),
  );
  private readonly subcategoriesSubject = new BehaviorSubject<CatalogTaxonomy[]>(
    this.readInitialTaxonomies('subcategory'),
  );
  private readonly loadingSubject = new BehaviorSubject<boolean>(isFirebaseConfigured && !!this.firestore);

  readonly loading$ = this.loadingSubject.asObservable();
  readonly categories$ = this.categoriesSubject.asObservable();
  readonly subcategories$ = this.subcategoriesSubject.asObservable();
  readonly collections$ = this.collectionsSubject.asObservable();
  readonly all$ = combineLatest([this.categories$, this.subcategories$, this.collections$]).pipe(
    map(([categories, subcategories, collections]) => ({ categories, subcategories, collections })),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    let pendingStreams = 3;
    const completeStream = () => {
      pendingStreams -= 1;

      if (pendingStreams <= 0) {
        this.loadingSubject.next(false);
      }
    };

    collectionData(
      query(collection(this.firestore, firestoreCollections.productCategories), orderBy('name', 'asc')),
      { idField: 'id' },
    ).subscribe({
      next: (items) => {
        this.categoriesSubject.next(
          this.sortTaxonomies((items as Array<SerializedCatalogTaxonomy>).map((item) => reviveTaxonomy(item))),
        );
        completeStream();
      },
      error: () => completeStream(),
    });

    collectionData(
      query(collection(this.firestore, firestoreCollections.productSubcategories), orderBy('name', 'asc')),
      { idField: 'id' },
    ).subscribe({
      next: (items) => {
        this.subcategoriesSubject.next(
          this.sortTaxonomies((items as Array<SerializedCatalogTaxonomy>).map((item) => reviveTaxonomy(item))),
        );
        completeStream();
      },
      error: () => completeStream(),
    });

    collectionData(
      query(collection(this.firestore, firestoreCollections.productCollections), orderBy('name', 'asc')),
      { idField: 'id' },
    ).subscribe({
      next: (items) => {
        this.collectionsSubject.next(
          this.sortTaxonomies((items as Array<SerializedCatalogTaxonomy>).map((item) => reviveTaxonomy(item))),
        );
        completeStream();
      },
      error: () => completeStream(),
    });
  }

  get categoriesSnapshot(): CatalogTaxonomy[] {
    return this.categoriesSubject.value;
  }

  get collectionsSnapshot(): CatalogTaxonomy[] {
    return this.collectionsSubject.value;
  }

  get subcategoriesSnapshot(): CatalogTaxonomy[] {
    return this.subcategoriesSubject.value;
  }

  async createTaxonomy(type: TaxonomyType, draft: TaxonomyDraft): Promise<CatalogTaxonomy> {
    const normalizedName = draft.name.trim();

    if (!normalizedName) {
      throw new Error('El nombre no puede quedar vacio.');
    }

    const existing = this.getSubject(type).value.find(
      (item) => item.slug === slugify(draft.slug || normalizedName),
    );

    if (existing) {
      throw new Error('Ya existe un elemento con ese nombre.');
    }

    const taxonomy = this.toTaxonomy(type, draft);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getTaxonomyDoc(type, taxonomy.id), taxonomy);
      return taxonomy;
    }

    this.setLocalTaxonomies(type, [taxonomy, ...this.getSubject(type).value]);
    return taxonomy;
  }

  async updateTaxonomy(type: TaxonomyType, taxonomyId: string, draft: TaxonomyDraft): Promise<void> {
    const subject = this.getSubject(type);
    const existing = subject.value.find((item) => item.id === taxonomyId);

    if (!existing) {
      throw new Error('No se encontro el elemento que intentas actualizar.');
    }

    const nextSlug = slugify(draft.slug || draft.name);
    const duplicate = subject.value.find((item) => item.id !== taxonomyId && item.slug === nextSlug);

    if (duplicate) {
      throw new Error('Ya existe otro elemento con ese nombre.');
    }

    const nextItem: CatalogTaxonomy = {
      ...existing,
      name: draft.name.trim(),
      slug: nextSlug,
      position: this.normalizePosition(draft.position, existing.position),
      updatedAt: new Date(),
    };

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getTaxonomyDoc(type, taxonomyId), nextItem);
      return;
    }

    this.setLocalTaxonomies(
      type,
      subject.value.map((item) => (item.id === taxonomyId ? nextItem : item)),
    );
  }

  async deleteTaxonomy(type: TaxonomyType, taxonomyId: string): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await deleteDoc(this.getTaxonomyDoc(type, taxonomyId));
      return;
    }

    this.setLocalTaxonomies(
      type,
      this.getSubject(type).value.filter((item) => item.id !== taxonomyId),
    );
  }

  async syncFromProducts(products: Product[]): Promise<{ categories: number; subcategories: number; collections: number }> {
    const nextCategories = this.mergeWithProducts(this.categoriesSubject.value, products, 'category');
    const nextSubcategories = this.mergeWithProducts(this.subcategoriesSubject.value, products, 'subcategory');
    const nextCollections = this.mergeWithProducts(this.collectionsSubject.value, products, 'collection');
    const addedCategories = Math.max(0, nextCategories.length - this.categoriesSubject.value.length);
    const addedSubcategories = Math.max(0, nextSubcategories.length - this.subcategoriesSubject.value.length);
    const addedCollections = Math.max(0, nextCollections.length - this.collectionsSubject.value.length);

    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const item of nextCategories) {
        batch.set(this.getTaxonomyDoc('category', item.id), item);
      }

      for (const item of nextCollections) {
        batch.set(this.getTaxonomyDoc('collection', item.id), item);
      }

      for (const item of nextSubcategories) {
        batch.set(this.getTaxonomyDoc('subcategory', item.id), item);
      }

      await batch.commit();
    } else {
      this.setLocalTaxonomies('category', nextCategories);
      this.setLocalTaxonomies('subcategory', nextSubcategories);
      this.setLocalTaxonomies('collection', nextCollections);
    }

    return {
      categories: addedCategories,
      subcategories: addedSubcategories,
      collections: addedCollections,
    };
  }

  private mergeWithProducts(
    current: CatalogTaxonomy[],
    products: Product[],
    type: TaxonomyType,
  ): CatalogTaxonomy[] {
    const entries = new Map(current.map((item) => [item.slug, item]));
    const values = type === 'category'
      ? products.map((product) => ({ name: product.category, slug: product.categorySlug }))
      : type === 'subcategory'
        ? products
            .filter((product): product is Product & { subcategory: string; subcategorySlug: string } =>
              !!product.subcategory && !!product.subcategorySlug,
            )
            .map((product) => ({ name: product.subcategory, slug: product.subcategorySlug }))
        : products
          .filter((product): product is Product & { collection: string; collectionSlug: string } =>
            !!product.collection && !!product.collectionSlug,
          )
          .map((product) => ({ name: product.collection, slug: product.collectionSlug }));

    for (const entry of values) {
      if (entries.has(entry.slug)) {
        continue;
      }

      const now = new Date();
      const nextPosition = this.getNextPosition(Array.from(entries.values()));
      entries.set(entry.slug, {
        id: `${type}-${entry.slug}`,
        name: entry.name,
        slug: entry.slug,
        position: nextPosition,
        createdAt: now,
        updatedAt: now,
      });
    }

    return this.sortTaxonomies(Array.from(entries.values()));
  }

  private toTaxonomy(type: TaxonomyType, draft: TaxonomyDraft): CatalogTaxonomy {
    const name = draft.name.trim();
    const slug = slugify(draft.slug || name);
    const now = new Date();

    return {
      id: `${type}-${slug}`,
      name,
      slug,
      position: this.normalizePosition(draft.position, this.getNextPosition(this.getSubject(type).value)),
      createdAt: now,
      updatedAt: now,
    };
  }

  private readInitialTaxonomies(type: TaxonomyType): CatalogTaxonomy[] {
    if (isFirebaseConfigured) {
      return [];
    }

    const fallback = this.mergeWithProducts([], MOCK_PRODUCTS, type);

    return this.localStorageService.read<CatalogTaxonomy[]>(
      this.getStorageKey(type),
      fallback,
      (items) =>
        (items as Array<SerializedCatalogTaxonomy>).map((item) => reviveTaxonomy(item)),
    );
  }

  private setLocalTaxonomies(type: TaxonomyType, items: CatalogTaxonomy[]): void {
    const nextItems = this.sortTaxonomies(items);
    this.getSubject(type).next(nextItems);
    this.localStorageService.write(this.getStorageKey(type), nextItems);
  }

  private getTaxonomyDoc(type: TaxonomyType, taxonomyId: string) {
    return doc(
      this.firestore!,
      type === 'category'
        ? firestoreCollections.productCategories
        : type === 'subcategory'
          ? firestoreCollections.productSubcategories
        : firestoreCollections.productCollections,
      taxonomyId,
    );
  }

  private getSubject(type: TaxonomyType) {
    return type === 'category'
      ? this.categoriesSubject
      : type === 'subcategory'
        ? this.subcategoriesSubject
        : this.collectionsSubject;
  }

  private getStorageKey(type: TaxonomyType): string {
    return type === 'category'
      ? CATEGORY_STORAGE_KEY
      : type === 'subcategory'
        ? SUBCATEGORY_STORAGE_KEY
        : COLLECTION_STORAGE_KEY;
  }

  private sortTaxonomies(items: CatalogTaxonomy[]): CatalogTaxonomy[] {
    return [...items].sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.name.localeCompare(right.name, 'es');
    });
  }

  private normalizePosition(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
  }

  private getNextPosition(items: CatalogTaxonomy[]): number {
    if (!items.length) {
      return 10;
    }

    return Math.max(...items.map((item) => item.position || 0)) + 10;
  }
}
