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
} from '@angular/fire/firestore';
import { BehaviorSubject, map } from 'rxjs';

import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import {
  DiscountCode,
  DiscountCodeDraft,
  isDiscountCodeActive,
} from '../models/discount-code.model';
import { OrderItem } from '../models/order.model';
import { LocalStorageService } from './local-storage.service';

const DISCOUNT_CODES_STORAGE_KEY = 'martura_discount_codes';

@Injectable({ providedIn: 'root' })
export class DiscountCodesService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly discountCodesSubject = new BehaviorSubject<DiscountCode[]>(this.readInitialDiscountCodes());
  private readonly loadingSubject = new BehaviorSubject<boolean>(isFirebaseConfigured && !!this.firestore);

  readonly loading$ = this.loadingSubject.asObservable();
  readonly discountCodes$ = this.discountCodesSubject.asObservable();
  readonly activeDiscountCodes$ = this.discountCodes$.pipe(
    map((discountCodes) => discountCodes.filter((discountCode) => isDiscountCodeActive(discountCode))),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    collectionData(
      query(collection(this.firestore, firestoreCollections.discountCodes), orderBy('code', 'asc')),
      { idField: 'id' },
    ).subscribe({
      next: (entries) => {
        this.discountCodesSubject.next((entries as Array<Partial<DiscountCode>>).map((entry) => this.reviveCode(entry)));
        this.loadingSubject.next(false);
      },
      error: () => {
        this.loadingSubject.next(false);
      },
    });
  }

  get discountCodesSnapshot(): DiscountCode[] {
    return this.discountCodesSubject.value;
  }

  get activeDiscountCodesSnapshot(): DiscountCode[] {
    return this.discountCodesSnapshot.filter((discountCode) => isDiscountCodeActive(discountCode));
  }

  getCodeByValue(value: string | null): DiscountCode | null {
    if (!value) {
      return null;
    }

    const normalizedValue = value.trim().toUpperCase();
    return this.discountCodesSnapshot.find((discountCode) => discountCode.code === normalizedValue) ?? null;
  }

  async createDiscountCode(draft: DiscountCodeDraft): Promise<void> {
    const discountCode = this.toDiscountCode(draft);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getDiscountCodeDoc(discountCode.id), discountCode);
      return;
    }

    this.setDiscountCodes([...this.discountCodesSubject.value, discountCode]);
  }

  async updateDiscountCode(discountCodeId: string, draft: DiscountCodeDraft): Promise<void> {
    const existingCode = this.discountCodesSubject.value.find((discountCode) => discountCode.id === discountCodeId);

    if (!existingCode) {
      throw new Error('No se encontró el código que intentas editar.');
    }

    const nextCode = this.toDiscountCode({
      ...draft,
      id: existingCode.id,
    });

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getDiscountCodeDoc(discountCodeId), nextCode);
      return;
    }

    this.setDiscountCodes(
      this.discountCodesSubject.value.map((discountCode) =>
        discountCode.id === discountCodeId ? nextCode : discountCode,
      ),
    );
  }

  async deleteDiscountCode(discountCodeId: string): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await deleteDoc(this.getDiscountCodeDoc(discountCodeId));
      return;
    }

    this.setDiscountCodes(this.discountCodesSubject.value.filter((discountCode) => discountCode.id !== discountCodeId));
  }

  resolveDiscount(
    codeValue: string | null,
    items: OrderItem[],
  ): { code: DiscountCode; amount: number } | null {
    const code = this.getCodeByValue(codeValue);

    if (!code || !isDiscountCodeActive(code)) {
      return null;
    }

    const eligibleItems = code.scope === 'all'
      ? items
      : items.filter((item) => code.productIds.includes(item.productId));
    const eligibleSubtotal = eligibleItems.reduce((total, item) => total + item.lineTotal, 0);

    if (eligibleSubtotal <= 0) {
      return null;
    }

    const rawAmount = code.type === 'fixed'
      ? code.value
      : eligibleSubtotal * (code.value / 100);

    return {
      code,
      amount: normalizeMoney(Math.min(eligibleSubtotal, rawAmount)),
    };
  }

  private setDiscountCodes(discountCodes: DiscountCode[]): void {
    const nextCodes = [...discountCodes].sort((left, right) => left.code.localeCompare(right.code, 'es'));
    this.discountCodesSubject.next(nextCodes);
    this.localStorageService.write(DISCOUNT_CODES_STORAGE_KEY, nextCodes);
  }

  private readInitialDiscountCodes(): DiscountCode[] {
    if (isFirebaseConfigured) {
      return [];
    }

    return this.localStorageService.read<DiscountCode[]>(DISCOUNT_CODES_STORAGE_KEY, [], (entries) =>
      (entries as Array<Partial<DiscountCode>>).map((entry) => this.reviveCode(entry)),
    );
  }

  private reviveCode(entry: Partial<DiscountCode>): DiscountCode {
    return {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : `discount-${Date.now()}`,
      code: typeof entry.code === 'string' ? entry.code.trim().toUpperCase() : '',
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      type: entry.type === 'fixed' ? 'fixed' : 'percentage',
      value: typeof entry.value === 'number' && Number.isFinite(entry.value) ? Math.max(0, entry.value) : 0,
      active: entry.active !== false,
      scope: entry.scope === 'products' ? 'products' : 'all',
      productIds: Array.isArray(entry.productIds)
        ? entry.productIds.filter((productId): productId is string => typeof productId === 'string')
        : [],
      startsAt: normalizeNullableDate(entry.startsAt),
      endsAt: normalizeNullableDate(entry.endsAt),
    };
  }

  private toDiscountCode(draft: DiscountCodeDraft): DiscountCode {
    const code = draft.code.trim().toUpperCase();

    if (!code) {
      throw new Error('El código no puede quedar vacío.');
    }

    return this.reviveCode({
      ...draft,
      id: draft.id ?? `discount-${code.toLowerCase()}`,
      code,
      description: draft.description.trim(),
    });
  }

  private getDiscountCodeDoc(discountCodeId: string) {
    return doc(this.firestore!, firestoreCollections.discountCodes, discountCodeId);
  }
}

function normalizeNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return null;
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
