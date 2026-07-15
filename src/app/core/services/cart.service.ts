import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

import { CartItem, CartSummary } from '../models/cart.model';
import { isProductAvailable, Product } from '../models/product.model';
import { reviveProduct } from '../firebase/firestore.mappers';
import { AppUser } from '../models/user.model';
import { resolveProductPricing } from '../utils/product-pricing';
import { AuthService } from './auth.service';
import { CampaignsService } from './campaigns.service';
import { LocalStorageService } from './local-storage.service';

const SHIPPING_PRICE = 4.95;
const LEGACY_CART_STORAGE_KEY = 'martura_cart';
const GUEST_CART_STORAGE_KEY = 'martura_cart_guest';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly authService = inject(AuthService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly localStorageService = inject(LocalStorageService);
  private currentStorageKey = GUEST_CART_STORAGE_KEY;
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>(
    this.readItems(this.currentStorageKey),
  );

  readonly items$ = this.itemsSubject.asObservable();
  readonly summary$ = combineLatest([this.items$, this.campaignsService.activeCampaigns$]).pipe(
    map(([items]) => this.buildSummary(items)),
  );
  readonly totalItems$ = this.summary$.pipe(map((summary) => summary.totalItems));

  constructor() {
    this.migrateLegacyCartIfNeeded();
    this.itemsSubject.next(this.readItems(this.currentStorageKey));
    this.syncWithSession(this.authService.currentUser);

    this.authService.user$.subscribe((user) => {
      this.syncWithSession(user);
    });
  }

  addItem(product: Product, variant: string = product.sizes[0], quantity = 1): void {
    if (!isProductAvailable(product) || quantity <= 0) {
      return;
    }

    const currentItems = this.itemsSubject.value;
    const existingItem = currentItems.find(
      (item) => item.product.id === product.id && item.variant === variant,
    );
    const nextQuantity = Math.min(
      product.stock,
      (existingItem?.quantity ?? 0) + quantity,
    );

    if (existingItem) {
      this.setItems(
        currentItems.map((item) =>
          item === existingItem ? { ...item, quantity: nextQuantity } : item,
        ),
      );
      return;
    }

    this.setItems([...currentItems, { product, variant, quantity: Math.min(product.stock, quantity) }]);
  }

  updateQuantity(productId: string, variant: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId, variant);
      return;
    }

    const currentItem = this.itemsSubject.value.find(
      (item) => item.product.id === productId && item.variant === variant,
    );
    const nextQuantity = Math.min(currentItem?.product.stock ?? quantity, quantity);

    if (nextQuantity <= 0) {
      this.removeItem(productId, variant);
      return;
    }

    this.setItems(
      this.itemsSubject.value.map((item) =>
        item.product.id === productId && item.variant === variant
          ? { ...item, quantity: nextQuantity }
          : item,
      ),
    );
  }

  removeItem(productId: string, variant: string): void {
    this.setItems(
      this.itemsSubject.value.filter(
        (item) => item.product.id !== productId || item.variant !== variant,
      ),
    );
  }

  clear(): void {
    this.setItems([]);
  }

  private buildSummary(items: CartItem[]): CartSummary {
    const subtotal = items.reduce((total, item) => {
      const price = resolveProductPricing(
        item.product,
        this.campaignsService.activeCampaignsSnapshot,
      ).effectivePrice;
      return total + price * item.quantity;
    }, 0);
    const shipping = subtotal > 0 && subtotal < 75 ? SHIPPING_PRICE : 0;

    return {
      items,
      subtotal,
      shipping,
      total: subtotal + shipping,
      totalItems: items.reduce((total, item) => total + item.quantity, 0),
    };
  }

  private setItems(items: CartItem[]): void {
    this.itemsSubject.next(items);
    this.localStorageService.write(this.currentStorageKey, items);
  }

  private syncWithSession(user: AppUser | null): void {
    const nextStorageKey = this.getStorageKey(user);

    if (nextStorageKey === this.currentStorageKey) {
      return;
    }

    const previousStorageKey = this.currentStorageKey;
    const previousItems = this.itemsSubject.value;
    const nextItems = this.readItems(nextStorageKey);

    this.currentStorageKey = nextStorageKey;

    if (previousStorageKey === GUEST_CART_STORAGE_KEY && user) {
      const mergedItems = this.mergeItems(nextItems, previousItems);
      this.itemsSubject.next(mergedItems);
      this.localStorageService.write(this.currentStorageKey, mergedItems);

      if (previousItems.length > 0) {
        this.localStorageService.remove(GUEST_CART_STORAGE_KEY);
      }

      return;
    }

    this.itemsSubject.next(nextItems);
  }

  private getStorageKey(user: AppUser | null): string {
    return user ? `martura_cart_${user.id}` : GUEST_CART_STORAGE_KEY;
  }

  private readItems(storageKey: string): CartItem[] {
    return this.localStorageService.read(storageKey, [], this.reviveItems);
  }

  private migrateLegacyCartIfNeeded(): void {
    const legacyItems = this.localStorageService.read<CartItem[]>(
      LEGACY_CART_STORAGE_KEY,
      [],
      this.reviveItems,
    );

    if (legacyItems.length === 0) {
      return;
    }

    const guestItems = this.readItems(GUEST_CART_STORAGE_KEY);

    if (guestItems.length === 0) {
      this.localStorageService.write(GUEST_CART_STORAGE_KEY, legacyItems);
    }

    this.localStorageService.remove(LEGACY_CART_STORAGE_KEY);
  }

  private mergeItems(baseItems: CartItem[], incomingItems: CartItem[]): CartItem[] {
    const merged = [...baseItems];

    for (const incomingItem of incomingItems) {
      const existingItem = merged.find(
        (item) =>
          item.product.id === incomingItem.product.id &&
          item.variant === incomingItem.variant,
      );

      if (!existingItem) {
        merged.push(incomingItem);
        continue;
      }

      existingItem.quantity = Math.min(
        existingItem.product.stock,
        existingItem.quantity + incomingItem.quantity,
      );
    }

    return merged;
  }

  private reviveItems(items: CartItem[]): CartItem[] {
    return items.map((item) => ({
      ...item,
      product: reviveProduct(item.product as Product & { createdAt: unknown }),
    }));
  }
}
