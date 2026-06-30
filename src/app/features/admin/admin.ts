import { AsyncPipe, CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { combineLatest, map } from 'rxjs';

import { Product, ProductDraft } from '../../core/models/product.model';
import { OrdersService } from '../../core/services/orders.service';
import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-admin',
  imports: [AsyncPipe, CurrencyPipe, ReactiveFormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly formBuilder = inject(FormBuilder);
  private readonly productsService = inject(ProductsService);
  private readonly ordersService = inject(OrdersService);

  readonly editingProductId = signal<string | null>(null);
  readonly products$ = this.productsService.products$;
  readonly pendingOrders$ = this.ordersService.pendingOrders$;
  readonly productForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    category: ['Bolsos', [Validators.required]],
    description: ['', [Validators.required]],
    story: [''],
    originalPrice: [0, [Validators.required, Validators.min(1)]],
    offerPrice: [0],
    hasOffer: [false],
    imageUrl: ['', [Validators.required]],
    stock: [1, [Validators.required, Validators.min(0)]],
    sizes: ['Unica', [Validators.required]],
    colors: ['Natural'],
    featured: [false],
  });

  readonly stats$ = combineLatest([this.products$, this.pendingOrders$]).pipe(
    map(([products, pendingOrders]) => {
      const lowStock = products.filter((product) => product.stock <= 4).length;
      const inventoryValue = products.reduce(
        (total, product) => total + (product.offerPrice ?? product.originalPrice) * product.stock,
        0,
      );

      return {
        products: products.length,
        lowStock,
        inventoryValue,
        pendingOrders: pendingOrders.length,
      };
    }),
  );

  async saveProduct(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    const draft = this.formToDraft();
    const editingProductId = this.editingProductId();

    if (editingProductId) {
      await this.productsService.updateProduct(editingProductId, draft);
    } else {
      await this.productsService.createProduct(draft);
    }

    this.resetForm();
  }

  editProduct(product: Product): void {
    this.editingProductId.set(product.id);
    this.productForm.setValue({
      name: product.name,
      category: product.category,
      description: product.description,
      story: product.story,
      originalPrice: product.originalPrice,
      offerPrice: product.offerPrice ?? 0,
      hasOffer: product.offerPrice !== null,
      imageUrl: product.imageUrl,
      stock: product.stock,
      sizes: product.sizes.join(', '),
      colors: product.colors.join(', '),
      featured: product.featured,
    });
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.productsService.deleteProduct(productId);

    if (this.editingProductId() === productId) {
      this.resetForm();
    }
  }

  async resetProducts(): Promise<void> {
    await this.productsService.resetProducts();
    this.resetForm();
  }

  resetForm(): void {
    this.editingProductId.set(null);
    this.productForm.reset({
      name: '',
      category: 'Bolsos',
      description: '',
      story: '',
      originalPrice: 0,
      offerPrice: 0,
      hasOffer: false,
      imageUrl: '',
      stock: 1,
      sizes: 'Unica',
      colors: 'Natural',
      featured: false,
    });
  }

  async markOrderAsSent(orderId: string): Promise<void> {
    await this.ordersService.markAsSent(orderId);
  }

  async clearOrders(): Promise<void> {
    await this.ordersService.clearOrders();
  }

  private formToDraft(): ProductDraft {
    const value = this.productForm.getRawValue();

    return {
      name: value.name,
      description: value.description,
      story: value.story || value.description,
      originalPrice: value.originalPrice,
      offerPrice: value.hasOffer ? value.offerPrice : null,
      imageUrl: value.imageUrl,
      gallery: [value.imageUrl],
      category: value.category,
      categorySlug: this.slugify(value.category),
      stock: value.stock,
      sizes: this.commaListToArray(value.sizes),
      colors: this.commaListToArray(value.colors),
      campaignId: value.hasOffer ? 'cmp-manual' : null,
      featured: value.featured,
    };
  }

  private commaListToArray(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
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
