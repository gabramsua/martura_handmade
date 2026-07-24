import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

import { CartItem, CartSummary } from '../models/cart.model';
import { isProductAvailable, Product } from '../models/product.model';
import { reviveProduct } from '../firebase/firestore.mappers';
import { resolveProductPricing } from '../utils/product-pricing';
import { CampaignsService } from './campaigns.service';
import { LocalStorageService } from './local-storage.service';
import { ShopSettingsService } from './shop-settings.service';

const CART_STORAGE_KEY = 'martura_cart_guest';
const LEGACY_CART_STORAGE_KEY = 'martura_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly campaignsService = inject(CampaignsService);
  private readonly localStorageService = inject(LocalStorageService);
  private readonly shopSettingsService = inject(ShopSettingsService);
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>(this.readItems());

  readonly items$ = this.itemsSubject.asObservable();
  readonly summary$ = combineLatest([
    this.items$,
    this.campaignsService.activeCampaigns$,
    this.shopSettingsService.settings$,
  ]).pipe(
    map(([items]) => this.buildSummary(items)),
  );
  readonly totalItems$ = this.summary$.pipe(map((summary) => summary.totalItems));

  constructor() {
    this.migrateLegacyCartIfNeeded();
    this.itemsSubject.next(this.readItems());
  }

  addItem(product: Product, variant: string = product.sizes[0] ?? 'Única', quantity = 1): void {
    if (!isProductAvailable(product) || quantity <= 0) {
      return;
    }

    const currentItems = this.itemsSubject.value;
    const existingItem = currentItems.find(
      (item) => item.product.id === product.id && item.variant === variant,
    );
    const nextQuantity = Math.min(product.stock, (existingItem?.quantity ?? 0) + quantity);

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
    const shipping = subtotal > 0 ? this.shopSettingsService.settingsSnapshot.shippingPrice : 0;

    return {
      items,
      subtotal: normalizeMoney(subtotal),
      shipping: normalizeMoney(shipping),
      total: normalizeMoney(subtotal + shipping),
      totalItems: items.reduce((total, item) => total + item.quantity, 0),
    };
  }

  private setItems(items: CartItem[]): void {
    this.itemsSubject.next(items);
    this.localStorageService.write(CART_STORAGE_KEY, items);
  }

  private readItems(): CartItem[] {
    return this.localStorageService.read(CART_STORAGE_KEY, [], this.reviveItems);
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

    const currentItems = this.readItems();

    if (currentItems.length === 0) {
      this.localStorageService.write(CART_STORAGE_KEY, legacyItems);
    }

    this.localStorageService.remove(LEGACY_CART_STORAGE_KEY);
  }

  private reviveItems(items: CartItem[]): CartItem[] {
    return items.map((item) => ({
      ...item,
      product: reviveProduct(item.product as Product & { createdAt: unknown }),
    }));
  }
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
