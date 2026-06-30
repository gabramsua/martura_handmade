import { Injectable } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';

import { CartItem, CartSummary } from '../models/cart.model';
import { Product } from '../models/product.model';

const SHIPPING_PRICE = 4.95;

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>([]);

  readonly items$ = this.itemsSubject.asObservable();
  readonly summary$ = this.items$.pipe(map((items) => this.buildSummary(items)));
  readonly totalItems$ = this.summary$.pipe(map((summary) => summary.totalItems));

  addItem(product: Product, variant: string = product.sizes[0], quantity = 1): void {
    const currentItems = this.itemsSubject.value;
    const existingItem = currentItems.find(
      (item) => item.product.id === product.id && item.variant === variant,
    );

    if (existingItem) {
      this.itemsSubject.next(
        currentItems.map((item) =>
          item === existingItem ? { ...item, quantity: item.quantity + quantity } : item,
        ),
      );
      return;
    }

    this.itemsSubject.next([...currentItems, { product, variant, quantity }]);
  }

  updateQuantity(productId: string, variant: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId, variant);
      return;
    }

    this.itemsSubject.next(
      this.itemsSubject.value.map((item) =>
        item.product.id === productId && item.variant === variant ? { ...item, quantity } : item,
      ),
    );
  }

  removeItem(productId: string, variant: string): void {
    this.itemsSubject.next(
      this.itemsSubject.value.filter(
        (item) => item.product.id !== productId || item.variant !== variant,
      ),
    );
  }

  clear(): void {
    this.itemsSubject.next([]);
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
}
