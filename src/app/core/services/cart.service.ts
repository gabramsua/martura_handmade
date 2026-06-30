import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';

import { CartItem, CartSummary } from '../models/cart.model';
import { Product } from '../models/product.model';
import { LocalStorageService } from './local-storage.service';

const SHIPPING_PRICE = 4.95;
const CART_STORAGE_KEY = 'martura_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly localStorageService = inject(LocalStorageService);
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>(
    this.localStorageService.read(CART_STORAGE_KEY, [], this.reviveItems),
  );

  readonly items$ = this.itemsSubject.asObservable();
  readonly summary$ = this.items$.pipe(map((items) => this.buildSummary(items)));
  readonly totalItems$ = this.summary$.pipe(map((summary) => summary.totalItems));

  addItem(product: Product, variant: string = product.sizes[0], quantity = 1): void {
    const currentItems = this.itemsSubject.value;
    const existingItem = currentItems.find(
      (item) => item.product.id === product.id && item.variant === variant,
    );

    if (existingItem) {
      this.setItems(
        currentItems.map((item) =>
          item === existingItem ? { ...item, quantity: item.quantity + quantity } : item,
        ),
      );
      return;
    }

    this.setItems([...currentItems, { product, variant, quantity }]);
  }

  updateQuantity(productId: string, variant: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId, variant);
      return;
    }

    this.setItems(
      this.itemsSubject.value.map((item) =>
        item.product.id === productId && item.variant === variant ? { ...item, quantity } : item,
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
      const price = item.product.offerPrice ?? item.product.originalPrice;
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
    this.localStorageService.write(CART_STORAGE_KEY, items);
  }

  private reviveItems(items: CartItem[]): CartItem[] {
    return items.map((item) => ({
      ...item,
      product: {
        ...item.product,
        createdAt: new Date(item.product.createdAt),
      },
    }));
  }
}
