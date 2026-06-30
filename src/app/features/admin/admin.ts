import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { combineLatest, map, startWith } from 'rxjs';

import { authMode } from '../../core/firebase/firebase.config';
import {
  Campaign,
  CampaignDiscountType,
  CampaignDraft,
  CampaignLifecycle,
} from '../../core/models/campaign.model';
import {
  normalizeProductStatus,
  Product,
  ProductDraft,
  ProductPricingMode,
  ProductStatus,
} from '../../core/models/product.model';
import {
  CheckoutOrder,
  DeliveryMethod,
  getOrderStatusLabel,
  OrderFilters,
  OrderStatus,
} from '../../core/models/order.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { CampaignsService } from '../../core/services/campaigns.service';
import { MediaService } from '../../core/services/media.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProductsService } from '../../core/services/products.service';

@Component({
  selector: 'app-admin',
  imports: [AsyncPipe, CurrencyPipe, DatePipe, ReactiveFormsModule],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly formBuilder = inject(FormBuilder);
  private readonly campaignsService = inject(CampaignsService);
  private readonly mediaService = inject(MediaService);
  private readonly productsService = inject(ProductsService);
  private readonly ordersService = inject(OrdersService);

  readonly modeLabel = authMode === 'firebase' ? 'Firestore en vivo' : 'Modo mock';
  readonly pricingOptions: Array<{ value: ProductPricingMode; label: string }> = [
    { value: 'regular', label: 'Precio normal' },
    { value: 'individual_offer', label: 'Oferta individual' },
    { value: 'campaign', label: 'Campana de temporada' },
  ];
  readonly discountTypeOptions: Array<{ value: CampaignDiscountType; label: string }> = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed', label: 'Importe fijo' },
  ];
  readonly statusOptions: Array<{ value: ProductStatus; label: string }> = [
    { value: 'active', label: 'Activo' },
    { value: 'sold_out', label: 'Agotado' },
    { value: 'hidden', label: 'Oculto' },
  ];
  readonly orderStatusOptions: Array<{ value: OrderFilters['status']; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'new', label: 'Nuevos' },
    { value: 'confirmed', label: 'Confirmados' },
    { value: 'prepared', label: 'Preparados' },
    { value: 'completed', label: 'Completados' },
    { value: 'cancelled', label: 'Cancelados' },
  ];
  readonly deliveryMethodOptions: Array<{ value: OrderFilters['deliveryMethod']; label: string }> = [
    { value: 'all', label: 'Todas' },
    { value: 'shipping', label: 'Envio' },
    { value: 'pickup', label: 'Recogida' },
  ];
  readonly editingCampaignId = signal<string | null>(null);
  readonly editingProductId = signal<string | null>(null);
  readonly feedbackMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isSavingCampaign = signal(false);
  readonly isSavingProduct = signal(false);
  readonly isUploadingImage = signal(false);
  readonly isResettingCampaigns = signal(false);
  readonly isResettingProducts = signal(false);
  readonly isClearingOrders = signal(false);
  readonly activeCampaignActionId = signal<string | null>(null);
  readonly activeProductActionId = signal<string | null>(null);
  readonly activeOrderActionId = signal<string | null>(null);
  readonly loading$ = this.productsService.loading$;
  readonly campaignsLoading$ = this.campaignsService.loading$;
  readonly campaigns$ = this.campaignsService.campaigns$;
  readonly products$ = this.productsService.products$;
  readonly categories$ = this.productsService.categories$;
  readonly collections$ = this.productsService.collections$;
  readonly orders$ = this.ordersService.orders$;
  readonly pendingOrders$ = this.ordersService.pendingOrders$;
  readonly orderFiltersForm = this.formBuilder.nonNullable.group({
    status: ['all' as OrderFilters['status']],
    deliveryMethod: ['all' as OrderFilters['deliveryMethod']],
    query: [''],
  });
  readonly campaignForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    badge: ['', [Validators.required, Validators.minLength(2)]],
    description: ['', [Validators.required, Validators.minLength(8)]],
    discountType: ['percentage' as CampaignDiscountType, [Validators.required]],
    discountValue: [10, [Validators.required, Validators.min(1)]],
    active: [true],
    startsAt: [''],
    endsAt: [''],
  });
  readonly productForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    category: ['Bolsos', [Validators.required]],
    collection: [''],
    description: ['', [Validators.required]],
    story: [''],
    originalPrice: [0, [Validators.required, Validators.min(1)]],
    pricingMode: ['regular' as ProductPricingMode, [Validators.required]],
    offerPrice: [0, [Validators.min(0)]],
    campaignId: [''],
    imageUrl: ['', [Validators.required, Validators.pattern(/^https?:\/\/.+/i)]],
    stock: [1, [Validators.required, Validators.min(0)]],
    status: ['active' as ProductStatus, [Validators.required]],
    sizes: ['Unica', [Validators.required]],
    colors: ['Natural'],
    featured: [false],
  }, {
    validators: [this.offerValidator],
  });

  readonly stats$ = combineLatest([this.products$, this.pendingOrders$, this.campaigns$]).pipe(
    map(([products, pendingOrders]) => {
      const lowStock = products.filter((product) => product.status === 'active' && product.stock <= 4).length;
      const soldOut = products.filter((product) => product.status === 'sold_out').length;
      const hidden = products.filter((product) => product.status === 'hidden').length;
      const inventoryValue = products.reduce(
        (total, product) =>
          total +
          resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice *
            product.stock,
        0,
      );

      return {
        products: products.length,
        lowStock,
        soldOut,
        hidden,
        inventoryValue,
        pendingOrders: pendingOrders.length,
      };
    }),
  );
  readonly campaignSummaries$ = combineLatest([this.campaigns$, this.products$]).pipe(
    map(([campaigns, products]) =>
      campaigns.map((campaign) => ({
        campaign,
        usageCount: products.filter((product) => product.campaignId === campaign.id).length,
      })),
    ),
  );
  readonly filteredOrders$ = combineLatest([
    this.orders$,
    this.orderFiltersForm.valueChanges.pipe(startWith(this.orderFiltersForm.getRawValue())),
  ]).pipe(
    map(([orders, filters]) => {
      const query = (filters.query ?? '').trim().toLowerCase();
      const status = filters.status ?? 'all';
      const deliveryMethod = filters.deliveryMethod ?? 'all';

      return orders.filter((order) => {
        if (status !== 'all' && order.status !== status) {
          return false;
        }

        if (deliveryMethod !== 'all' && order.customer.deliveryMethod !== deliveryMethod) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [
          order.id,
          order.customer.name,
          order.customer.email,
          order.customer.phone,
          order.customer.city,
          order.customer.postalCode,
          order.customer.province,
          ...order.items.map((item) => item.productName),
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });
    }),
  );

  async saveCampaign(): Promise<void> {
    if (this.campaignForm.invalid) {
      this.campaignForm.markAllAsTouched();
      return;
    }

    try {
      this.isSavingCampaign.set(true);
      this.clearMessages();

      const draft = this.formToCampaignDraft();
      const editingCampaignId = this.editingCampaignId();

      if (editingCampaignId) {
        await this.campaignsService.updateCampaign(editingCampaignId, draft);
        this.feedbackMessage.set('Campana actualizada correctamente.');
      } else {
        await this.campaignsService.createCampaign(draft);
        this.feedbackMessage.set('Campana creada correctamente.');
      }

      this.resetCampaignForm(false);
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo guardar la campana.'));
    } finally {
      this.isSavingCampaign.set(false);
    }
  }

  async saveProduct(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      return;
    }

    try {
      this.isSavingProduct.set(true);
      this.clearMessages();

      const draft = this.formToDraft();
      const editingProductId = this.editingProductId();

      if (editingProductId) {
        await this.productsService.updateProduct(editingProductId, draft);
        this.feedbackMessage.set('Producto actualizado en catalogo.');
      } else {
        await this.productsService.createProduct(draft);
        this.feedbackMessage.set('Producto creado correctamente.');
      }

      this.resetForm(false);
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo guardar el producto.'));
    } finally {
      this.isSavingProduct.set(false);
    }
  }

  editProduct(product: Product): void {
    this.clearMessages();
    this.editingProductId.set(product.id);
    this.productForm.setValue({
      name: product.name,
      category: product.category,
      collection: product.collection ?? '',
      description: product.description,
      story: product.story,
      originalPrice: product.originalPrice,
      pricingMode: product.pricingMode,
      offerPrice: product.offerPrice ?? 0,
      campaignId: product.campaignId ?? '',
      imageUrl: product.imageUrl,
      stock: product.stock,
      status: product.status,
      sizes: product.sizes.join(', '),
      colors: product.colors.join(', '),
      featured: product.featured,
    });
  }

  editCampaign(campaign: Campaign): void {
    this.clearMessages();
    this.editingCampaignId.set(campaign.id);
    this.campaignForm.setValue({
      name: campaign.name,
      badge: campaign.badge,
      description: campaign.description,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      active: campaign.active,
      startsAt: this.formatDateInput(campaign.startsAt),
      endsAt: this.formatDateInput(campaign.endsAt),
    });
  }

  async deleteCampaign(campaignId: string, usageCount: number): Promise<void> {
    const confirmationMessage = usageCount > 0
      ? `Esta campana esta asociada a ${usageCount} producto(s). Si la borras, esos productos conservaran el precio base hasta que les asignes otra promo. Quieres continuar?`
      : 'Se borrara esta campana. Quieres continuar?';

    if (!confirm(confirmationMessage)) {
      return;
    }

    try {
      this.activeCampaignActionId.set(campaignId);
      this.clearMessages();
      await this.campaignsService.deleteCampaign(campaignId);

      if (this.editingCampaignId() === campaignId) {
        this.resetCampaignForm(false);
      }

      this.feedbackMessage.set('Campana eliminada.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo borrar la campana.'));
    } finally {
      this.activeCampaignActionId.set(null);
    }
  }

  async deleteProduct(productId: string): Promise<void> {
    if (!confirm('Se borrara este producto del catalogo. Quieres continuar?')) {
      return;
    }

    try {
      this.activeProductActionId.set(productId);
      this.clearMessages();
      await this.productsService.deleteProduct(productId);

      if (this.editingProductId() === productId) {
        this.resetForm(false);
      }

      this.feedbackMessage.set('Producto eliminado del catalogo.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo borrar el producto.'));
    } finally {
      this.activeProductActionId.set(null);
    }
  }

  async resetProducts(): Promise<void> {
    if (!confirm('Se restaurara el catalogo demo completo. Quieres continuar?')) {
      return;
    }

    try {
      this.isResettingProducts.set(true);
      this.clearMessages();
      await this.productsService.resetProducts();
      this.resetForm(false);
      this.feedbackMessage.set('Catalogo restaurado con los productos demo.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo restaurar el catalogo.'));
    } finally {
      this.isResettingProducts.set(false);
    }
  }

  async resetCampaigns(): Promise<void> {
    if (!confirm('Se restauraran las campanas demo. Quieres continuar?')) {
      return;
    }

    try {
      this.isResettingCampaigns.set(true);
      this.clearMessages();
      await this.campaignsService.resetCampaigns();
      this.resetCampaignForm(false);
      this.feedbackMessage.set('Campanas demo restauradas.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudieron restaurar las campanas.'));
    } finally {
      this.isResettingCampaigns.set(false);
    }
  }

  resetForm(clearMessages = true): void {
    this.editingProductId.set(null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.productForm.reset({
      name: '',
      category: 'Bolsos',
      collection: '',
      description: '',
      story: '',
      originalPrice: 0,
      pricingMode: 'regular',
      offerPrice: 0,
      campaignId: '',
      imageUrl: '',
      stock: 1,
      status: 'active',
      sizes: 'Unica',
      colors: 'Natural',
      featured: false,
    });
  }

  resetCampaignForm(clearMessages = true): void {
    this.editingCampaignId.set(null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.campaignForm.reset({
      name: '',
      badge: '',
      description: '',
      discountType: 'percentage',
      discountValue: 10,
      active: true,
      startsAt: '',
      endsAt: '',
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    try {
      this.activeOrderActionId.set(orderId);
      this.clearMessages();
      await this.ordersService.updateStatus(orderId, status);
      this.feedbackMessage.set(`Pedido actualizado a "${this.getOrderStatusName(status)}".`);
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo actualizar el pedido.'));
    } finally {
      this.activeOrderActionId.set(null);
    }
  }

  async clearOrders(): Promise<void> {
    if (!confirm('Se borraran todos los pedidos registrados. Quieres continuar?')) {
      return;
    }

    try {
      this.isClearingOrders.set(true);
      this.clearMessages();
      await this.ordersService.clearOrders();
      this.feedbackMessage.set('Pedidos limpiados correctamente.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudieron limpiar los pedidos.'));
    } finally {
      this.isClearingOrders.set(false);
    }
  }

  get saveButtonLabel(): string {
    if (this.isUploadingImage()) {
      return 'Subiendo imagen...';
    }

    if (this.isSavingProduct()) {
      return this.editingProductId() ? 'Guardando...' : 'Creando...';
    }

    return this.editingProductId() ? 'Guardar cambios' : 'Crear producto';
  }

  get previewImageUrl(): string | null {
    const value = this.productForm.controls.imageUrl.value.trim();
    return value || null;
  }

  get pricePreview(): number {
    return resolveProductPricing(
      {
        originalPrice: this.productForm.controls.originalPrice.value || 0,
        offerPrice: this.productForm.controls.pricingMode.value === 'individual_offer'
          ? this.productForm.controls.offerPrice.value || 0
          : null,
        campaignId:
          this.productForm.controls.pricingMode.value === 'campaign'
            ? this.productForm.controls.campaignId.value || null
            : null,
        pricingMode: this.productForm.controls.pricingMode.value,
      },
      this.campaignsService.activeCampaignsSnapshot,
    ).effectivePrice;
  }

  get offerErrorMessage(): string | null {
    if (this.productForm.errors?.['invalidOffer']) {
      return 'El precio en oferta debe ser mayor que 0 y menor que el precio original.';
    }

    if (this.productForm.errors?.['missingCampaign']) {
      return 'Selecciona una campana cuando uses precio por temporada.';
    }

    return null;
  }

  get comparePricePreview(): number | null {
    const pricing = resolveProductPricing(
      {
        originalPrice: this.productForm.controls.originalPrice.value || 0,
        offerPrice: this.productForm.controls.pricingMode.value === 'individual_offer'
          ? this.productForm.controls.offerPrice.value || 0
          : null,
        campaignId:
          this.productForm.controls.pricingMode.value === 'campaign'
            ? this.productForm.controls.campaignId.value || null
            : null,
        pricingMode: this.productForm.controls.pricingMode.value,
      },
      this.campaignsService.activeCampaignsSnapshot,
    );

    if (!pricing.hasDiscount) {
      return null;
    }

    return pricing.originalPrice;
  }

  get previewStatus(): ProductStatus {
    return normalizeProductStatus(
      this.productForm.controls.status.value,
      this.productForm.controls.stock.value,
    );
  }

  get previewCampaign(): string | null {
    const campaignId = this.productForm.controls.pricingMode.value === 'campaign'
      ? this.productForm.controls.campaignId.value
      : '';
    const campaign = this.campaignsService.getCampaignById(campaignId || null);
    return campaign?.badge ?? null;
  }

  get saveCampaignButtonLabel(): string {
    if (this.isSavingCampaign()) {
      return this.editingCampaignId() ? 'Guardando...' : 'Creando...';
    }

    return this.editingCampaignId() ? 'Guardar campana' : 'Crear campana';
  }

  onPricingModeChange(mode: ProductPricingMode): void {
    if (mode === 'regular') {
      this.productForm.controls.offerPrice.setValue(0);
      this.productForm.controls.campaignId.setValue('');
      return;
    }

    if (mode === 'individual_offer') {
      this.productForm.controls.campaignId.setValue('');
      return;
    }

    this.productForm.controls.offerPrice.setValue(0);
  }

  onStockChange(value: string): void {
    const stock = Number(value);

    if (Number.isNaN(stock)) {
      return;
    }

    if (stock <= 0 && this.productForm.controls.status.value !== 'hidden') {
      this.productForm.controls.status.setValue('sold_out');
      return;
    }

    if (stock > 0 && this.productForm.controls.status.value === 'sold_out') {
      this.productForm.controls.status.setValue('active');
    }
  }

  onStatusChange(status: ProductStatus): void {
    if (status === 'sold_out' && this.productForm.controls.stock.value > 0) {
      this.productForm.controls.stock.setValue(0);
      return;
    }

    if (status === 'active' && this.productForm.controls.stock.value <= 0) {
      this.productForm.controls.stock.setValue(1);
    }
  }

  getStatusLabel(status: ProductStatus): string {
    return this.statusOptions.find((option) => option.value === status)?.label ?? status;
  }

  getPricingLabel(mode: ProductPricingMode): string {
    return this.pricingOptions.find((option) => option.value === mode)?.label ?? mode;
  }

  getCampaignLabel(campaignId: string | null): string {
    return this.campaignsService.getCampaignById(campaignId)?.badge ?? 'Campana';
  }

  getCampaignLifecycleLabel(campaign: Campaign): string {
    const lifecycle = this.campaignsService.getCampaignLifecycle(campaign);

    switch (lifecycle) {
      case 'active':
        return 'Activa';
      case 'scheduled':
        return 'Programada';
      case 'ended':
        return 'Finalizada';
      case 'inactive':
      default:
        return 'Inactiva';
    }
  }

  getCampaignLifecycleClass(campaign: Campaign): string {
    return this.campaignsService.getCampaignLifecycle(campaign);
  }

  getProductPrice(product: Product): number {
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice;
  }

  getProductComparePrice(product: Product): number | null {
    const pricing = resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot);
    return pricing.hasDiscount ? pricing.originalPrice : null;
  }

  getProductPricingBadge(product: Product): string | null {
    if (product.pricingMode === 'campaign' && product.campaignId) {
      return this.getCampaignLabel(product.campaignId);
    }

    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).badgeLabel;
  }

  getProductTaxonomy(product: Product): string {
    return product.collection ? `${product.category} · ${product.collection}` : product.category;
  }

  trackCampaign(campaign: Campaign): string {
    return campaign.id;
  }

  getOrderStatus(order: CheckoutOrder): string {
    return getOrderStatusLabel(order.status, order.customer.deliveryMethod);
  }

  getOrderPrimaryAction(order: CheckoutOrder): { label: string; status: OrderStatus } | null {
    switch (order.status) {
      case 'new':
        return { label: 'Confirmar pedido', status: 'confirmed' };
      case 'confirmed':
        return { label: 'Marcar preparado', status: 'prepared' };
      case 'prepared':
        return {
          label: order.customer.deliveryMethod === 'shipping' ? 'Marcar enviado' : 'Marcar recogido',
          status: 'completed',
        };
      case 'cancelled':
        return { label: 'Reabrir pedido', status: 'new' };
      case 'completed':
      default:
        return null;
    }
  }

  canCancelOrder(order: CheckoutOrder): boolean {
    return order.status !== 'cancelled' && order.status !== 'completed';
  }

  getDeliveryMethodLabel(deliveryMethod: DeliveryMethod): string {
    return deliveryMethod === 'shipping' ? 'Envio' : 'Recogida';
  }

  getOrderDestination(order: CheckoutOrder): string {
    if (order.customer.deliveryMethod === 'pickup') {
      return 'Recogida en taller';
    }

    return [order.customer.addressLine1, `${order.customer.postalCode} ${order.customer.city}`, order.customer.province]
      .filter(Boolean)
      .join(', ');
  }

  private getOrderStatusName(status: OrderStatus): string {
    switch (status) {
      case 'new':
        return 'Nuevo';
      case 'confirmed':
        return 'Confirmado';
      case 'prepared':
        return 'Preparado';
      case 'completed':
        return 'Completado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return status;
    }
  }

  async uploadImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];

    if (!file) {
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      this.errorMessage.set('La imagen supera los 4 MB. Usa un archivo mas ligero.');
      input.value = '';
      return;
    }

    try {
      this.isUploadingImage.set(true);
      this.clearMessages();
      const imageUrl = await this.mediaService.uploadProductImage(file);
      this.productForm.controls.imageUrl.setValue(imageUrl);
      this.productForm.controls.imageUrl.markAsDirty();
      this.feedbackMessage.set('Imagen subida a Firebase Storage.');
    } catch (error) {
      this.errorMessage.set(this.getErrorMessage(error, 'No se pudo subir la imagen.'));
    } finally {
      this.isUploadingImage.set(false);
      input.value = '';
    }
  }

  private formToDraft(): ProductDraft {
    const value = this.productForm.getRawValue();
    const stock = value.status === 'sold_out' ? 0 : value.stock;
    const status = normalizeProductStatus(value.status, stock);

    return {
      name: value.name,
      description: value.description,
      story: value.story || value.description,
      originalPrice: value.originalPrice,
      pricingMode: value.pricingMode,
      offerPrice: value.pricingMode === 'individual_offer' ? value.offerPrice : null,
      imageUrl: value.imageUrl,
      gallery: [value.imageUrl],
      category: value.category,
      categorySlug: this.slugify(value.category),
      collection: value.collection || null,
      collectionSlug: value.collection ? this.slugify(value.collection) : null,
      stock,
      sizes: this.commaListToArray(value.sizes),
      colors: this.commaListToArray(value.colors),
      campaignId: value.pricingMode === 'campaign' ? value.campaignId || null : null,
      featured: value.featured,
      status,
    };
  }

  private formToCampaignDraft(): CampaignDraft {
    const value = this.campaignForm.getRawValue();

    return {
      name: value.name,
      badge: value.badge,
      description: value.description,
      discountType: value.discountType,
      discountValue: value.discountValue,
      active: value.active,
      startsAt: value.startsAt ? new Date(value.startsAt) : null,
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
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

  private clearMessages(): void {
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);
  }

  private formatDateInput(value: Date | null): string {
    if (!value) {
      return '';
    }

    return value.toISOString().slice(0, 10);
  }

  private offerValidator(control: AbstractControl): ValidationErrors | null {
    const pricingMode = control.get('pricingMode')?.value as ProductPricingMode | undefined;
    const offerPrice = Number(control.get('offerPrice')?.value ?? 0);
    const originalPrice = Number(control.get('originalPrice')?.value ?? 0);
    const campaignId = String(control.get('campaignId')?.value ?? '');

    if (pricingMode === 'individual_offer') {
      return offerPrice > 0 && offerPrice < originalPrice ? null : { invalidOffer: true };
    }

    if (pricingMode === 'campaign') {
      return campaignId ? null : { missingCampaign: true };
    }

    if (pricingMode !== 'regular') {
      return null;
    }

    if (offerPrice < 0) {
      return null;
    }

    return null;
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
