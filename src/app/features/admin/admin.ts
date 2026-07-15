import { AsyncPipe, CurrencyPipe, DatePipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { combineLatest, map, startWith } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { authMode } from '../../core/firebase/firebase.config';
import {
  Campaign,
  CampaignDiscountType,
  CampaignDraft,
} from '../../core/models/campaign.model';
import { CustomerProfile } from '../../core/models/customer.model';
import {
  normalizeProductCampaignIds,
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
  isOrderActive,
  OrderFilters,
  OrderItem,
  OrderStatus,
} from '../../core/models/order.model';
import { CatalogTaxonomy } from '../../core/models/taxonomy.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { slugify } from '../../core/utils/slug';
import { AlertsService } from '../../core/services/alerts.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { CustomersService } from '../../core/services/customers.service';
import { MediaService } from '../../core/services/media.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProductsService } from '../../core/services/products.service';
import { TaxonomiesService } from '../../core/services/taxonomies.service';

type CustomerSegment = 'all' | 'repeat' | 'recent';
type WorkspaceKey = 'overview' | 'product' | 'customers' | 'orders' | 'catalog' | 'taxonomy' | 'campaigns';

interface WorkspaceNavItem {
  key: WorkspaceKey;
  label: string;
  caption: string;
}

interface AnalyticsRow {
  id: string;
  label: string;
  revenue: number;
  units: number;
  orders: number;
  customers: number;
  averageOrderValue: number;
  share: number;
}

interface AnalyticsBucket {
  id: string;
  label: string;
  revenue: number;
  units: number;
  orderIds: Set<string>;
  customerIds: Set<string>;
}

interface AnalyticsReport {
  startDate: string;
  endDate: string;
  orders: number;
  revenue: number;
  units: number;
  uniqueCustomers: number;
  averageTicket: number;
  topCollection: string | null;
  topCampaign: string | null;
  collectionRows: AnalyticsRow[];
  campaignRows: AnalyticsRow[];
}

interface CustomerDetail {
  customer: CustomerProfile;
  orders: CheckoutOrder[];
  activeOrders: number;
  validOrders: number;
  cancelledOrders: number;
  totalSpent: number;
  averageTicket: number;
  firstOrder: CheckoutOrder | null;
  lastOrder: CheckoutOrder | null;
  favouriteTaxonomy: string | null;
  topCollections: string[];
  campaignSignals: string[];
}

interface TaxonomyOption {
  id: string;
  name: string;
  slug: string;
  position: number;
  source: 'managed' | 'catalog';
}

interface TaxonomySummaryEntry {
  taxonomy: CatalogTaxonomy;
  usageCount: number;
}

@Component({
  selector: 'app-admin',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    DatePipe,
    PercentPipe,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly formBuilder = inject(FormBuilder);
  private readonly alertsService = inject(AlertsService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly customersService = inject(CustomersService);
  private readonly mediaService = inject(MediaService);
  private readonly productsService = inject(ProductsService);
  private readonly ordersService = inject(OrdersService);
  private readonly taxonomiesService = inject(TaxonomiesService);

  readonly modeLabel = authMode === 'firebase' ? 'Firestore en vivo' : 'Modo mock';
  readonly pricingOptions: Array<{ value: ProductPricingMode; label: string }> = [
    { value: 'regular', label: 'Precio normal' },
    { value: 'individual_offer', label: 'Oferta individual' },
    { value: 'campaign', label: 'Campaña de temporada' },
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
    { value: 'shipping', label: 'Envío' },
    { value: 'pickup', label: 'Recogida' },
  ];
  readonly customerSegmentOptions: Array<{ value: CustomerSegment; label: string }> = [
    { value: 'all', label: 'Todas' },
    { value: 'repeat', label: 'Recurrentes' },
    { value: 'recent', label: 'Últimos 30 días' },
  ];
  readonly editingCampaignId = signal<string | null>(null);
  readonly editingProductId = signal<string | null>(null);
  readonly editingCategoryId = signal<string | null>(null);
  readonly editingCollectionId = signal<string | null>(null);
  readonly selectedCustomerId = signal<string | null>(null);
  readonly activeWorkspace = signal<WorkspaceKey>('overview');
  readonly feedbackMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isSavingCampaign = signal(false);
  readonly isSavingProduct = signal(false);
  readonly isSavingCategory = signal(false);
  readonly isSavingCollection = signal(false);
  readonly isUploadingImage = signal(false);
  readonly isResettingCampaigns = signal(false);
  readonly isResettingProducts = signal(false);
  readonly isClearingOrders = signal(false);
  readonly isSyncingCustomers = signal(false);
  readonly isSyncingTaxonomies = signal(false);
  readonly activeCampaignActionId = signal<string | null>(null);
  readonly activeProductActionId = signal<string | null>(null);
  readonly activeCategoryActionId = signal<string | null>(null);
  readonly activeCollectionActionId = signal<string | null>(null);
  readonly activeOrderActionId = signal<string | null>(null);
  readonly loading$ = this.productsService.loading$;
  readonly campaignsLoading$ = this.campaignsService.loading$;
  readonly customersLoading$ = this.customersService.loading$;
  readonly taxonomiesLoading$ = this.taxonomiesService.loading$;
  readonly campaigns$ = this.campaignsService.campaigns$;
  readonly customers$ = this.customersService.customers$;
  readonly products$ = this.productsService.products$;
  readonly categories$ = this.productsService.categories$;
  readonly collections$ = this.productsService.collections$;
  readonly managedCategories$ = this.taxonomiesService.categories$;
  readonly managedCollections$ = this.taxonomiesService.collections$;
  readonly orders$ = this.ordersService.orders$;
  readonly pendingOrders$ = this.ordersService.pendingOrders$;
  readonly workspaceNavItems: WorkspaceNavItem[] = [
    { key: 'overview', label: 'Resumen', caption: 'Métricas y radar' },
    { key: 'product', label: 'Producto', caption: 'Alta y edición' },
    { key: 'customers', label: 'Clientes', caption: 'Fichas y valor' },
    { key: 'orders', label: 'Pedidos', caption: 'Seguimiento' },
    { key: 'catalog', label: 'Catálogo', caption: 'Listado y stock' },
    { key: 'taxonomy', label: 'Taxonomías', caption: 'Categorías y colecciones' },
    { key: 'campaigns', label: 'Campañas', caption: 'Promociones activas' },
  ];
  readonly currentWorkspace = computed(
    () => this.workspaceNavItems.find((item) => item.key === this.activeWorkspace()) ?? this.workspaceNavItems[0],
  );
  readonly orderFiltersForm = this.formBuilder.nonNullable.group({
    status: ['all' as OrderFilters['status']],
    deliveryMethod: ['all' as OrderFilters['deliveryMethod']],
    query: [''],
  });
  readonly customerFiltersForm = this.formBuilder.nonNullable.group({
    segment: ['all' as CustomerSegment],
    query: [''],
  });
  readonly categoryForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    position: [10, [Validators.required, Validators.min(0)]],
  });
  readonly collectionForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    position: [10, [Validators.required, Validators.min(0)]],
  });
  readonly analyticsFiltersForm = this.formBuilder.nonNullable.group({
    startDate: [this.getRelativeDateInput(-29)],
    endDate: [this.getRelativeDateInput(0)],
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
  }, {
    validators: [this.campaignDateRangeValidator],
  });
  readonly productForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    category: ['Bolsos', [Validators.required]],
    collection: [''],
    position: [10, [Validators.required, Validators.min(0)]],
    description: ['', [Validators.required]],
    story: [''],
    originalPrice: [0, [Validators.required, Validators.min(1)]],
    pricingMode: ['regular' as ProductPricingMode, [Validators.required]],
    offerPrice: [0, [Validators.min(0)]],
    campaignIds: [[] as string[]],
    stock: [1, [Validators.required, Validators.min(0)]],
    status: ['active' as ProductStatus, [Validators.required]],
    sizes: ['Unica', [Validators.required]],
    colors: ['Natural'],
    featured: [false],
  }, {
    validators: [this.offerValidator],
  });
  readonly galleryUrls = signal<string[]>([]);
  readonly galleryBaselineUrls = signal<string[]>([]);

  readonly stats$ = combineLatest([
    this.products$,
    this.pendingOrders$,
    this.campaigns$,
    this.orders$,
    this.customers$,
  ]).pipe(
    map(([products, pendingOrders, campaigns, orders, customers]) => {
      const lowStock = products.filter((product) => product.status === 'active' && product.stock <= 4).length;
      const soldOut = products.filter((product) => product.status === 'sold_out').length;
      const hidden = products.filter((product) => product.status === 'hidden').length;
      const validOrders = orders.filter((order) => order.status !== 'cancelled');
      const inventoryValue = products.reduce(
        (total, product) =>
          total +
          resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).effectivePrice *
            product.stock,
        0,
      );
      const revenue = validOrders.reduce((total, order) => total + order.total, 0);
      const repeatCustomers = customers.filter((customer) => customer.totalOrders > 1).length;
      const averageTicket = validOrders.length ? revenue / validOrders.length : 0;
      const activeCampaigns = campaigns.filter(
        (campaign) => this.campaignsService.getCampaignLifecycle(campaign) === 'active',
      ).length;

      return {
        products: products.length,
        lowStock,
        soldOut,
        hidden,
        inventoryValue,
        pendingOrders: pendingOrders.length,
        customers: customers.length,
        repeatCustomers,
        revenue,
        averageTicket,
        activeCampaigns,
      };
    }),
  );
  readonly dashboardRadar$ = combineLatest([this.customers$, this.products$]).pipe(
    map(([customers, products]) => ({
      topCustomers: [...customers]
        .sort((left, right) => right.totalSpent - left.totalSpent)
        .slice(0, 4),
      lowStockProducts: products
        .filter((product) => product.status === 'active' && product.stock <= 4)
        .sort((left, right) => left.stock - right.stock)
        .slice(0, 4),
    })),
  );
  readonly campaignSummaries$ = combineLatest([this.campaigns$, this.products$]).pipe(
    map(([campaigns, products]) =>
      campaigns.map((campaign) => ({
        campaign,
        linkedProducts: products
          .filter((product) => normalizeProductCampaignIds(product).includes(campaign.id))
          .map((product) => product.name),
        usageCount: products.filter((product) => normalizeProductCampaignIds(product).includes(campaign.id)).length,
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
  readonly filteredCustomers$ = combineLatest([
    this.customers$,
    this.customerFiltersForm.valueChanges.pipe(startWith(this.customerFiltersForm.getRawValue())),
  ]).pipe(
    map(([customers, filters]) => {
      const query = (filters.query ?? '').trim().toLowerCase();
      const segment = filters.segment ?? 'all';
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

      return customers.filter((customer) => {
        if (segment === 'repeat' && customer.totalOrders <= 1) {
          return false;
        }

        if (segment === 'recent' && (!customer.lastOrderAt || customer.lastOrderAt.getTime() < thirtyDaysAgo)) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack = [
          customer.name,
          customer.email,
          customer.phone ?? '',
          customer.city,
          customer.province,
          customer.postalCode,
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });
    }),
  );
  readonly availableCategories$ = combineLatest([this.managedCategories$, this.categories$]).pipe(
    map(([managed, catalog]) => {
      const options = this.mergeTaxonomyOptions(managed, catalog);
      return options.length
        ? options
        : [{ id: 'bolsos', name: 'Bolsos', slug: 'bolsos', position: 10, source: 'catalog' as const }];
    }),
  );
  readonly availableCollections$ = combineLatest([this.managedCollections$, this.collections$]).pipe(
    map(([managed, catalog]) => this.mergeTaxonomyOptions(managed, catalog)),
  );
  readonly taxonomySummaries$ = combineLatest([
    this.managedCategories$,
    this.managedCollections$,
    this.products$,
  ]).pipe(
    map(([categories, collections, products]) => ({
      categories: categories.map((taxonomy) => ({
        taxonomy,
        usageCount: products.filter((product) => product.categorySlug === taxonomy.slug).length,
      })),
      collections: collections.map((taxonomy) => ({
        taxonomy,
        usageCount: products.filter((product) => product.collectionSlug === taxonomy.slug).length,
      })),
    })),
  );
  readonly selectedCustomerDetail = toSignal(
    combineLatest([
      this.filteredCustomers$,
      this.orders$,
      toObservable(this.selectedCustomerId),
    ]).pipe(
      map(([customers, orders, selectedCustomerId]) => {
        if (!customers.length) {
          return null;
        }

        const customer =
          customers.find((entry) => entry.userId === selectedCustomerId) ??
          customers.find((entry) => entry.id === selectedCustomerId) ??
          customers[0];

        return this.buildCustomerDetail(customer, orders);
      }),
    ),
    { initialValue: null as CustomerDetail | null },
  );
  readonly selectedCustomerKey = computed(() => this.selectedCustomerDetail()?.customer.userId ?? null);
  readonly analytics = toSignal(
    combineLatest([
      this.orders$,
      this.products$,
      this.campaigns$,
      this.analyticsFiltersForm.valueChanges.pipe(startWith(this.analyticsFiltersForm.getRawValue())),
    ]).pipe(
      map(([orders, products, campaigns, filters]) =>
        this.buildAnalyticsReport(orders, products, campaigns, {
          startDate: filters.startDate ?? this.getRelativeDateInput(-29),
          endDate: filters.endDate ?? this.getRelativeDateInput(0),
        }),
      ),
    ),
    { initialValue: this.createEmptyAnalytics() },
  );
  readonly isBusy = computed(
    () =>
      this.isSavingCampaign() ||
      this.isSavingProduct() ||
      this.isSavingCategory() ||
      this.isSavingCollection() ||
      this.isUploadingImage() ||
      this.isResettingCampaigns() ||
      this.isResettingProducts() ||
      this.isClearingOrders() ||
      this.isSyncingCustomers() ||
      this.isSyncingTaxonomies(),
  );
  readonly busyMessage = computed(() => {
    if (this.isUploadingImage()) {
      return 'Subiendo imágenes a Firebase Storage...';
    }

    if (this.isSavingProduct()) {
      return this.editingProductId() ? 'Guardando cambios del producto...' : 'Creando producto...';
    }

    if (this.isSavingCampaign()) {
      return this.editingCampaignId() ? 'Guardando campaña...' : 'Creando campaña...';
    }

    if (this.isSavingCategory()) {
      return this.editingCategoryId() ? 'Guardando categoría...' : 'Creando categoría...';
    }

    if (this.isSavingCollection()) {
      return this.editingCollectionId() ? 'Guardando colección...' : 'Creando colección...';
    }

    if (this.isResettingProducts()) {
      return 'Restaurando el catálogo demo...';
    }

    if (this.isResettingCampaigns()) {
      return 'Restaurando las campañas demo...';
    }

    if (this.isClearingOrders()) {
      return 'Eliminando pedidos y recalculando clientas...';
    }

    if (this.isSyncingCustomers()) {
      return 'Reconstruyendo fichas de clientas desde los pedidos...';
    }

    if (this.isSyncingTaxonomies()) {
      return 'Importando categorías y colecciones desde el catálogo...';
    }

    return 'Guardando cambios...';
  });

  async saveCampaign(): Promise<void> {
    if (this.campaignForm.invalid) {
      this.campaignForm.markAllAsTouched();
      this.showValidationError(this.getCampaignValidationMessage());
      return;
    }

    try {
      this.isSavingCampaign.set(true);
      this.clearMessages();

      const draft = this.formToCampaignDraft();
      const editingCampaignId = this.editingCampaignId();
      const conflictMessage = this.getCampaignScheduleConflictMessage(draft, editingCampaignId);

      if (conflictMessage) {
        await this.showCampaignConflict(conflictMessage);
        return;
      }

      if (editingCampaignId) {
        await this.campaignsService.updateCampaign(editingCampaignId, draft);
        this.setSuccess('Campaña actualizada correctamente.');
      } else {
        await this.campaignsService.createCampaign(draft);
        this.setSuccess('Campaña creada correctamente.');
      }

      this.resetCampaignForm(false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar la campaña.');
    } finally {
      this.isSavingCampaign.set(false);
    }
  }

  async saveProduct(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      this.showValidationError(this.getProductValidationMessage());
      return;
    }

    if (!this.galleryUrls().length) {
      this.showValidationError('Sube al menos una imagen antes de guardar el producto.');
      return;
    }

    try {
      this.isSavingProduct.set(true);
      this.clearMessages();

      const draft = this.formToDraft();
      const editingProductId = this.editingProductId();
      const conflictMessage = this.getProductCampaignConflictMessage(draft);

      if (conflictMessage) {
        await this.showCampaignConflict(conflictMessage);
        return;
      }

      if (editingProductId) {
        await this.productsService.updateProduct(editingProductId, draft);
        this.setSuccess('Producto actualizado en catálogo.');
      } else {
        await this.productsService.createProduct(draft);
        this.setSuccess('Producto creado correctamente.');
      }

      this.resetForm(false, false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar el producto.');
    } finally {
      this.isSavingProduct.set(false);
    }
  }

  editProduct(product: Product): void {
    this.clearMessages();
    this.activeWorkspace.set('product');
    this.editingProductId.set(product.id);
    const gallery = product.gallery.length ? product.gallery : [product.imageUrl];
    this.galleryUrls.set(gallery);
    this.galleryBaselineUrls.set(gallery);
    this.productForm.setValue({
      name: product.name,
      category: product.category,
      collection: product.collection ?? '',
      position: product.position,
      description: product.description,
      story: product.story,
      originalPrice: product.originalPrice,
      pricingMode: product.pricingMode,
      offerPrice: product.offerPrice ?? 0,
      campaignIds: product.campaignIds,
      stock: product.stock,
      status: product.status,
      sizes: product.sizes.join(', '),
      colors: product.colors.join(', '),
      featured: product.featured,
    });
  }

  editCampaign(campaign: Campaign): void {
    this.clearMessages();
    this.activeWorkspace.set('campaigns');
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

  async saveCategory(): Promise<void> {
    if (this.categoryForm.invalid) {
      this.categoryForm.markAllAsTouched();
      this.showValidationError(this.getTaxonomyValidationMessage('category'));
      return;
    }

    try {
      this.isSavingCategory.set(true);
      this.clearMessages();
      const name = this.categoryForm.controls.name.value.trim();
      const position = this.categoryForm.controls.position.value;
      const existingCategory = this.taxonomiesService.categoriesSnapshot.find(
        (item) => item.id === this.editingCategoryId(),
      ) ?? null;

      if (this.editingCategoryId()) {
        await this.taxonomiesService.updateTaxonomy('category', this.editingCategoryId()!, { name, position });
        if (existingCategory) {
          await this.productsService.replaceTaxonomyReference('category', existingCategory.slug, {
            name,
            slug: slugify(name),
          });
        }
        this.setSuccess('Categoría actualizada.');
      } else {
        await this.taxonomiesService.createTaxonomy('category', { name, position });
        this.setSuccess('Categoría creada.');
      }

      this.resetCategoryForm(false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar la categoría.');
    } finally {
      this.isSavingCategory.set(false);
    }
  }

  async saveCollection(): Promise<void> {
    if (this.collectionForm.invalid) {
      this.collectionForm.markAllAsTouched();
      this.showValidationError(this.getTaxonomyValidationMessage('collection'));
      return;
    }

    try {
      this.isSavingCollection.set(true);
      this.clearMessages();
      const name = this.collectionForm.controls.name.value.trim();
      const position = this.collectionForm.controls.position.value;
      const existingCollection = this.taxonomiesService.collectionsSnapshot.find(
        (item) => item.id === this.editingCollectionId(),
      ) ?? null;

      if (this.editingCollectionId()) {
        await this.taxonomiesService.updateTaxonomy('collection', this.editingCollectionId()!, { name, position });
        if (existingCollection) {
          await this.productsService.replaceTaxonomyReference('collection', existingCollection.slug, {
            name,
            slug: slugify(name),
          });
        }
        this.setSuccess('Colección actualizada.');
      } else {
        await this.taxonomiesService.createTaxonomy('collection', { name, position });
        this.setSuccess('Colección creada.');
      }

      this.resetCollectionForm(false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar la colección.');
    } finally {
      this.isSavingCollection.set(false);
    }
  }

  editCategory(taxonomy: CatalogTaxonomy): void {
    this.clearMessages();
    this.activeWorkspace.set('taxonomy');
    this.editingCategoryId.set(taxonomy.id);
    this.categoryForm.setValue({ name: taxonomy.name, position: taxonomy.position });
  }

  editCollection(taxonomy: CatalogTaxonomy): void {
    this.clearMessages();
    this.activeWorkspace.set('taxonomy');
    this.editingCollectionId.set(taxonomy.id);
    this.collectionForm.setValue({ name: taxonomy.name, position: taxonomy.position });
  }

  selectCustomer(customerId: string): void {
    this.activeWorkspace.set('customers');
    this.selectedCustomerId.set(customerId);
  }

  clearCustomerSelection(): void {
    this.selectedCustomerId.set(null);
  }

  viewCustomerFromOrder(order: CheckoutOrder): void {
    this.activeWorkspace.set('customers');
    this.customerFiltersForm.patchValue(
      {
        segment: 'all',
        query: '',
      },
      { emitEvent: true },
    );
    this.selectedCustomerId.set(this.getOrderCustomerKey(order));
  }

  focusOrder(orderId: string): void {
    this.activeWorkspace.set('orders');
    this.orderFiltersForm.patchValue(
      {
        status: 'all',
        deliveryMethod: 'all',
        query: orderId,
      },
      { emitEvent: true },
    );
  }

  setAnalyticsWindow(days: number): void {
    this.analyticsFiltersForm.patchValue({
      startDate: this.getRelativeDateInput(-(days - 1)),
      endDate: this.getRelativeDateInput(0),
    });
  }

  async deleteCampaign(campaignId: string, usageCount: number): Promise<void> {
    const confirmationMessage = usageCount > 0
      ? `Esta campaña está asociada a ${usageCount} producto(s). Si la borras, esos productos conservarán el precio base hasta que les asignes otra promo. ¿Quieres continuar?`
      : 'Se borrará esta campaña. ¿Quieres continuar?';

    const confirmed = await this.alertsService.confirm({
      title: 'Eliminar campaña',
      text: confirmationMessage,
      confirmButtonText: 'Eliminar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeCampaignActionId.set(campaignId);
      this.clearMessages();
      await this.campaignsService.deleteCampaign(campaignId);

      if (this.editingCampaignId() === campaignId) {
        this.resetCampaignForm(false);
      }

      this.setSuccess('Campaña eliminada.');
    } catch (error) {
      this.setError(error, 'No se pudo borrar la campaña.');
    } finally {
      this.activeCampaignActionId.set(null);
    }
  }

  async deleteProduct(productId: string): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Eliminar producto',
      text: 'Se borrará este producto del catálogo. ¿Quieres continuar?',
      confirmButtonText: 'Eliminar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeProductActionId.set(productId);
      this.clearMessages();
      await this.productsService.deleteProduct(productId);

      if (this.editingProductId() === productId) {
        this.resetForm(false);
      }

      this.setSuccess('Producto eliminado del catálogo.');
    } catch (error) {
      this.setError(error, 'No se pudo borrar el producto.');
    } finally {
      this.activeProductActionId.set(null);
    }
  }

  async resetProducts(): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Restaurar catálogo demo',
      text: 'Se restaurará el catálogo demo completo. ¿Quieres continuar?',
      confirmButtonText: 'Restaurar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.isResettingProducts.set(true);
      this.clearMessages();
      await this.productsService.resetProducts();
      this.resetForm(false);
      this.setSuccess('Catálogo restaurado con los productos demo.');
    } catch (error) {
      this.setError(error, 'No se pudo restaurar el catálogo.');
    } finally {
      this.isResettingProducts.set(false);
    }
  }

  async resetCampaigns(): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Restaurar campañas demo',
      text: 'Se restaurarán las campañas demo. ¿Quieres continuar?',
      confirmButtonText: 'Restaurar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.isResettingCampaigns.set(true);
      this.clearMessages();
      await this.campaignsService.resetCampaigns();
      this.resetCampaignForm(false);
      this.setSuccess('Campañas demo restauradas.');
    } catch (error) {
      this.setError(error, 'No se pudieron restaurar las campañas.');
    } finally {
      this.isResettingCampaigns.set(false);
    }
  }

  resetForm(clearMessages = true, cleanupTransientUploads = true): void {
    const transientUploads = cleanupTransientUploads
      ? this.galleryUrls().filter((imageUrl) => !this.galleryBaselineUrls().includes(imageUrl))
      : [];

    if (transientUploads.length) {
      void this.mediaService.deleteProductImages(transientUploads);
    }

    this.editingProductId.set(null);
    this.galleryUrls.set([]);
    this.galleryBaselineUrls.set([]);

    if (clearMessages) {
      this.clearMessages();
    }

    this.productForm.reset({
      name: '',
      category: 'Bolsos',
      collection: '',
      position: this.getNextProductPosition(),
      description: '',
      story: '',
      originalPrice: 0,
      pricingMode: 'regular',
      offerPrice: 0,
      campaignIds: [],
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

  setWorkspace(workspace: WorkspaceKey): void {
    this.activeWorkspace.set(workspace);
  }

  trackWorkspace(_: number, item: WorkspaceNavItem): WorkspaceKey {
    return item.key;
  }

  resetCategoryForm(clearMessages = true): void {
    this.editingCategoryId.set(null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.categoryForm.reset({ name: '', position: this.getNextTaxonomyPosition('category') });
  }

  resetCollectionForm(clearMessages = true): void {
    this.editingCollectionId.set(null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.collectionForm.reset({ name: '', position: this.getNextTaxonomyPosition('collection') });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    try {
      this.activeOrderActionId.set(orderId);
      this.clearMessages();
      await this.ordersService.updateStatus(orderId, status);
      this.setSuccess(`Pedido actualizado a "${this.getOrderStatusName(status)}".`);
    } catch (error) {
      this.setError(error, 'No se pudo actualizar el pedido.');
    } finally {
      this.activeOrderActionId.set(null);
    }
  }

  async clearOrders(): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Limpiar pedidos',
      text: 'Se borrarán todos los pedidos registrados y se reiniciará el resumen de clientas. ¿Quieres continuar?',
      confirmButtonText: 'Limpiar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.isClearingOrders.set(true);
      this.clearMessages();
      await this.ordersService.clearOrders();
      this.selectedCustomerId.set(null);
      this.setSuccess('Pedidos limpiados correctamente.');
    } catch (error) {
      this.setError(error, 'No se pudieron limpiar los pedidos.');
    } finally {
      this.isClearingOrders.set(false);
    }
  }

  async rebuildCustomers(): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Sincronizar clientas',
      text: 'Se recalculará la base de clientas a partir de los pedidos existentes. ¿Quieres continuar?',
      confirmButtonText: 'Sincronizar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.isSyncingCustomers.set(true);
      this.clearMessages();
      const syncedCustomers = await this.customersService.rebuildCustomersFromOrders();
      this.setSuccess(`Base de clientas sincronizada. ${syncedCustomers} ficha(s) actualizada(s).`);
    } catch (error) {
      this.setError(error, 'No se pudo sincronizar la base de clientas.');
    } finally {
      this.isSyncingCustomers.set(false);
    }
  }

  async syncTaxonomiesFromCatalog(): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Sincronizar taxonomía',
      text: 'Importaremos categorías y colecciones detectadas en el catálogo actual para gestionarlas ya como datos propios.',
      confirmButtonText: 'Sincronizar',
      icon: 'question',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.isSyncingTaxonomies.set(true);
      this.clearMessages();
      const products = await this.readCurrentProducts();
      const result = await this.taxonomiesService.syncFromProducts(products);
      this.setSuccess(
        `Taxonomía sincronizada. ${result.categories} categoría(s) y ${result.collections} colección(es) nuevas.`,
      );
    } catch (error) {
      this.setError(error, 'No se pudo sincronizar la taxonomía desde el catálogo.');
    } finally {
      this.isSyncingTaxonomies.set(false);
    }
  }

  async deleteCategory(entry: TaxonomySummaryEntry): Promise<void> {
    if (entry.usageCount > 0) {
      this.setError(
        new Error(`La categoría "${entry.taxonomy.name}" sigue asignada a ${entry.usageCount} producto(s).`),
        'No se puede borrar una categoría en uso.',
      );
      return;
    }

    const confirmed = await this.alertsService.confirm({
      title: 'Eliminar categoría',
      text: `Se borrará la categoría "${entry.taxonomy.name}". ¿Quieres continuar?`,
      confirmButtonText: 'Eliminar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeCategoryActionId.set(entry.taxonomy.id);
      this.clearMessages();
      await this.taxonomiesService.deleteTaxonomy('category', entry.taxonomy.id);

      if (this.editingCategoryId() === entry.taxonomy.id) {
        this.resetCategoryForm(false);
      }

      this.setSuccess('Categoría eliminada.');
    } catch (error) {
      this.setError(error, 'No se pudo eliminar la categoría.');
    } finally {
      this.activeCategoryActionId.set(null);
    }
  }

  async deleteCollection(entry: TaxonomySummaryEntry): Promise<void> {
    if (entry.usageCount > 0) {
      this.setError(
        new Error(`La colección "${entry.taxonomy.name}" sigue asignada a ${entry.usageCount} producto(s).`),
        'No se puede borrar una colección en uso.',
      );
      return;
    }

    const confirmed = await this.alertsService.confirm({
      title: 'Eliminar colección',
      text: `Se borrará la colección "${entry.taxonomy.name}". ¿Quieres continuar?`,
      confirmButtonText: 'Eliminar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeCollectionActionId.set(entry.taxonomy.id);
      this.clearMessages();
      await this.taxonomiesService.deleteTaxonomy('collection', entry.taxonomy.id);

      if (this.editingCollectionId() === entry.taxonomy.id) {
        this.resetCollectionForm(false);
      }

      this.setSuccess('Colección eliminada.');
    } catch (error) {
      this.setError(error, 'No se pudo eliminar la colección.');
    } finally {
      this.activeCollectionActionId.set(null);
    }
  }

  isSelectedCustomer(customer: CustomerProfile): boolean {
    return this.selectedCustomerKey() === customer.userId;
  }

  belongsToSelectedCustomer(order: CheckoutOrder): boolean {
    const selectedCustomerKey = this.selectedCustomerKey();
    return !!selectedCustomerKey && selectedCustomerKey === this.getOrderCustomerKey(order);
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
    return this.galleryUrls()[0] ?? null;
  }

  get pricePreview(): number {
    return resolveProductPricing(
      {
        originalPrice: this.productForm.controls.originalPrice.value || 0,
        offerPrice: this.productForm.controls.pricingMode.value === 'individual_offer'
          ? this.productForm.controls.offerPrice.value || 0
          : null,
        campaignIds:
          this.productForm.controls.pricingMode.value === 'campaign'
            ? normalizeProductCampaignIds({ campaignIds: this.productForm.controls.campaignIds.value })
            : [],
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
      return 'Selecciona una campaña cuando uses precio por temporada.';
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
        campaignIds:
          this.productForm.controls.pricingMode.value === 'campaign'
            ? normalizeProductCampaignIds({ campaignIds: this.productForm.controls.campaignIds.value })
            : [],
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
    return resolveProductPricing(
      {
        originalPrice: this.productForm.controls.originalPrice.value || 0,
        offerPrice: this.productForm.controls.pricingMode.value === 'individual_offer'
          ? this.productForm.controls.offerPrice.value || 0
          : null,
        campaignIds:
          this.productForm.controls.pricingMode.value === 'campaign'
            ? normalizeProductCampaignIds({ campaignIds: this.productForm.controls.campaignIds.value })
            : [],
        pricingMode: this.productForm.controls.pricingMode.value,
      },
      this.campaignsService.activeCampaignsSnapshot,
    ).badgeLabel;
  }

  get saveCampaignButtonLabel(): string {
    if (this.isSavingCampaign()) {
      return this.editingCampaignId() ? 'Guardando...' : 'Creando...';
    }

    return this.editingCampaignId() ? 'Guardar campaña' : 'Crear campaña';
  }

  onPricingModeChange(mode: ProductPricingMode): void {
    if (mode === 'regular') {
      this.productForm.controls.offerPrice.setValue(0);
      this.productForm.controls.campaignIds.setValue([]);
      return;
    }

    if (mode === 'individual_offer') {
      this.productForm.controls.campaignIds.setValue([]);
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
    return this.campaignsService.getCampaignById(campaignId)?.badge ?? 'Campaña';
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
    return resolveProductPricing(product, this.campaignsService.activeCampaignsSnapshot).badgeLabel;
  }

  getProductTaxonomy(product: Product): string {
    return product.collection ? `${product.category} - ${product.collection}` : product.category;
  }

  getAssignedCampaignCount(product: Product): number {
    return normalizeProductCampaignIds(product).length;
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
    return deliveryMethod === 'shipping' ? 'Envío' : 'Recogida';
  }

  getOrderDestination(order: CheckoutOrder): string {
    if (order.customer.deliveryMethod === 'pickup') {
      return 'Recogida en taller';
    }

    return [order.customer.addressLine1, `${order.customer.postalCode} ${order.customer.city}`, order.customer.province]
      .filter(Boolean)
      .join(', ');
  }

  getCustomerLocation(customer: CustomerProfile): string {
    return [customer.city, customer.province].filter(Boolean).join(', ') || 'Sin ubicación';
  }

  getCustomerDeliveryPreferenceLabel(customer: CustomerProfile): string {
    if (customer.deliveryMethodPreference === 'pickup') {
      return 'Prefiere recogida';
    }

    if (customer.deliveryMethodPreference === 'shipping') {
      return 'Prefiere envío';
    }

    return 'Sin preferencia';
  }

  getItemTaxonomy(item: OrderItem): string {
    const category = item.category?.trim();
    const collection = item.collection?.trim();

    if (category && collection) {
      return `${category} - ${collection}`;
    }

    return collection || category || 'Sin clasificar';
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
    const files = input?.files ? Array.from(input.files) : [];

    if (!files.length) {
      return;
    }

    for (const file of files) {
      if (file.size > 4 * 1024 * 1024) {
        this.setError(new Error('La imagen supera los 4 MB. Usa un archivo más ligero.'), 'La imagen supera los 4 MB.');
        if (input) {
          input.value = '';
        }
        return;
      }
    }

    try {
      this.isUploadingImage.set(true);
      this.clearMessages();
      const nextGallery = [...this.galleryUrls()];

      for (const file of files) {
        const imageUrl = await this.mediaService.uploadProductImage(file);
        nextGallery.push(imageUrl);
      }

      this.galleryUrls.set(nextGallery);
      this.setSuccess(
        files.length === 1
          ? 'Imagen subida a Firebase Storage.'
          : `${files.length} imágenes subidas a Firebase Storage.`,
      );
    } catch (error) {
      this.setError(error, 'No se pudo subir la imagen.');
    } finally {
      this.isUploadingImage.set(false);
      if (input) {
        input.value = '';
      }
    }
  }

  private buildCustomerDetail(customer: CustomerProfile, orders: CheckoutOrder[]): CustomerDetail {
    const customerOrders = orders
      .filter((order) => this.getOrderCustomerKey(order) === customer.userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const validOrders = customerOrders.filter((order) => order.status !== 'cancelled');
    const activeOrders = customerOrders.filter((order) => isOrderActive(order.status)).length;
    const revenueByTaxonomy = new Map<string, number>();
    const revenueByCollection = new Map<string, number>();
    const campaignLabels = new Set<string>();

    for (const order of validOrders) {
      for (const item of order.items) {
        const taxonomy = this.getItemTaxonomy(item);
        revenueByTaxonomy.set(taxonomy, (revenueByTaxonomy.get(taxonomy) ?? 0) + item.lineTotal);

        const collectionLabel = item.collection?.trim() || item.category?.trim() || 'Sin clasificar';
        revenueByCollection.set(collectionLabel, (revenueByCollection.get(collectionLabel) ?? 0) + item.lineTotal);

        if (item.campaignName) {
          campaignLabels.add(item.campaignName);
        }
      }
    }

    return {
      customer,
      orders: customerOrders,
      activeOrders,
      validOrders: validOrders.length,
      cancelledOrders: customerOrders.length - validOrders.length,
      totalSpent: validOrders.reduce((total, order) => total + order.total, 0),
      averageTicket: validOrders.length
        ? validOrders.reduce((total, order) => total + order.total, 0) / validOrders.length
        : 0,
      firstOrder: customerOrders.length ? customerOrders[customerOrders.length - 1] : null,
      lastOrder: customerOrders[0] ?? null,
      favouriteTaxonomy: this.getHighestValueLabel(revenueByTaxonomy),
      topCollections: this.getTopLabels(revenueByCollection, 3),
      campaignSignals: Array.from(campaignLabels).slice(0, 3),
    };
  }

  private buildAnalyticsReport(
    orders: CheckoutOrder[],
    products: Product[],
    campaigns: Campaign[],
    filters: { startDate: string; endDate: string },
  ): AnalyticsReport {
    const normalizedRange = this.normalizeDateRange(filters.startDate, filters.endDate);
    const startDate = this.parseDateBoundary(normalizedRange.startDate, 'start');
    const endDate = this.parseDateBoundary(normalizedRange.endDate, 'end');
    const productById = new Map(products.map((product) => [product.id, product]));
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const collectionBuckets = new Map<string, AnalyticsBucket>();
    const campaignBuckets = new Map<string, AnalyticsBucket>();
    const filteredOrders = orders.filter((order) => {
      if (order.status === 'cancelled') {
        return false;
      }

      const createdAt = order.createdAt.getTime();

      if (startDate && createdAt < startDate.getTime()) {
        return false;
      }

      if (endDate && createdAt > endDate.getTime()) {
        return false;
      }

      return true;
    });
    const revenue = filteredOrders.reduce((total, order) => total + order.total, 0);
    const units = filteredOrders.reduce(
      (total, order) => total + order.items.reduce((itemsTotal, item) => itemsTotal + item.quantity, 0),
      0,
    );

    for (const order of filteredOrders) {
      const customerKey = this.getOrderCustomerKey(order);

      for (const item of order.items) {
        const sourceProduct = productById.get(item.productId);
        const collectionLabel = item.collection || sourceProduct?.collection || item.category || sourceProduct?.category || 'Sin clasificar';
        const collectionId = item.collectionSlug || sourceProduct?.collectionSlug || item.categorySlug || sourceProduct?.categorySlug || 'sin-clasificar';

        this.addToAnalyticsBucket(collectionBuckets, {
          id: collectionId,
          label: collectionLabel,
          revenue: item.lineTotal,
          units: item.quantity,
          orderId: order.id,
          customerId: customerKey,
        });

        const campaignId = item.campaignId || normalizeProductCampaignIds(sourceProduct ?? {}).at(0) || null;
        const campaignLabel = item.campaignName || (campaignId ? campaignById.get(campaignId)?.name ?? 'Campaña' : null);

        if (campaignId && campaignLabel) {
          this.addToAnalyticsBucket(campaignBuckets, {
            id: campaignId,
            label: campaignLabel,
            revenue: item.lineTotal,
            units: item.quantity,
            orderId: order.id,
            customerId: customerKey,
          });
        }
      }
    }

    const collectionRows = this.finalizeAnalyticsRows(collectionBuckets, revenue);
    const campaignRows = this.finalizeAnalyticsRows(campaignBuckets, revenue);

    return {
      startDate: normalizedRange.startDate,
      endDate: normalizedRange.endDate,
      orders: filteredOrders.length,
      revenue,
      units,
      uniqueCustomers: new Set(filteredOrders.map((order) => this.getOrderCustomerKey(order))).size,
      averageTicket: filteredOrders.length ? revenue / filteredOrders.length : 0,
      topCollection: collectionRows[0]?.label ?? null,
      topCampaign: campaignRows[0]?.label ?? null,
      collectionRows,
      campaignRows,
    };
  }

  private addToAnalyticsBucket(
    buckets: Map<string, AnalyticsBucket>,
    entry: {
      id: string;
      label: string;
      revenue: number;
      units: number;
      orderId: string;
      customerId: string;
    },
  ): void {
    const existing = buckets.get(entry.id);

    if (existing) {
      existing.revenue += entry.revenue;
      existing.units += entry.units;
      existing.orderIds.add(entry.orderId);
      existing.customerIds.add(entry.customerId);
      return;
    }

    buckets.set(entry.id, {
      id: entry.id,
      label: entry.label,
      revenue: entry.revenue,
      units: entry.units,
      orderIds: new Set([entry.orderId]),
      customerIds: new Set([entry.customerId]),
    });
  }

  private finalizeAnalyticsRows(buckets: Map<string, AnalyticsBucket>, totalRevenue: number): AnalyticsRow[] {
    return Array.from(buckets.values())
      .map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        revenue: bucket.revenue,
        units: bucket.units,
        orders: bucket.orderIds.size,
        customers: bucket.customerIds.size,
        averageOrderValue: bucket.orderIds.size ? bucket.revenue / bucket.orderIds.size : 0,
        share: totalRevenue > 0 ? bucket.revenue / totalRevenue : 0,
      }))
      .sort((left, right) => right.revenue - left.revenue);
  }

  private createEmptyAnalytics(): AnalyticsReport {
    return {
      startDate: this.getRelativeDateInput(-29),
      endDate: this.getRelativeDateInput(0),
      orders: 0,
      revenue: 0,
      units: 0,
      uniqueCustomers: 0,
      averageTicket: 0,
      topCollection: null,
      topCampaign: null,
      collectionRows: [],
      campaignRows: [],
    };
  }

  private formToDraft(): ProductDraft {
    const value = this.productForm.getRawValue();
    const stock = value.status === 'sold_out' ? 0 : value.stock;
    const status = normalizeProductStatus(value.status, stock);
    const gallery = this.galleryUrls();

    return {
      name: value.name,
      position: value.position,
      description: value.description,
      story: value.story || value.description,
      originalPrice: value.originalPrice,
      pricingMode: value.pricingMode,
      offerPrice: value.pricingMode === 'individual_offer' ? value.offerPrice : null,
      imageUrl: gallery[0] ?? '',
      gallery,
      category: value.category,
      categorySlug: slugify(value.category),
      collection: value.collection || null,
      collectionSlug: value.collection ? slugify(value.collection) : null,
      stock,
      sizes: this.commaListToArray(value.sizes),
      colors: this.commaListToArray(value.colors),
      campaignIds: value.pricingMode === 'campaign'
        ? normalizeProductCampaignIds({ campaignIds: value.campaignIds })
        : [],
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

  private clearMessages(): void {
    this.feedbackMessage.set(null);
    this.errorMessage.set(null);
  }

  private setSuccess(message: string): void {
    this.feedbackMessage.set(message);
    this.errorMessage.set(null);
    this.alertsService.toast('success', message);
  }

  private setError(error: unknown, fallback: string): void {
    const message = this.getErrorMessage(error, fallback);
    this.errorMessage.set(message);
    this.feedbackMessage.set(null);
    this.alertsService.toast('error', message);
  }

  private formatDateInput(value: Date | null): string {
    if (!value) {
      return '';
    }

    return value.toISOString().slice(0, 10);
  }

  private getRelativeDateInput(offsetDays: number): string {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() + offsetDays);
    return value.toISOString().slice(0, 10);
  }

  private normalizeDateRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
    if (!startDate || !endDate) {
      return {
        startDate: startDate || this.getRelativeDateInput(-29),
        endDate: endDate || this.getRelativeDateInput(0),
      };
    }

    return startDate <= endDate
      ? { startDate, endDate }
      : { startDate: endDate, endDate: startDate };
  }

  private parseDateBoundary(value: string, mode: 'start' | 'end'): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    if (mode === 'start') {
      date.setHours(0, 0, 0, 0);
    } else {
      date.setHours(23, 59, 59, 999);
    }

    return date;
  }

  private getOrderCustomerKey(order: CheckoutOrder): string {
    return order.userId || order.customer.email;
  }

  private getHighestValueLabel(entries: Map<string, number>): string | null {
    return Array.from(entries.entries())
      .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  }

  private getTopLabels(entries: Map<string, number>, limit: number): string[] {
    return Array.from(entries.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([label]) => label);
  }

  private offerValidator(control: AbstractControl): ValidationErrors | null {
    const pricingMode = control.get('pricingMode')?.value as ProductPricingMode | undefined;
    const offerPrice = Number(control.get('offerPrice')?.value ?? 0);
    const originalPrice = Number(control.get('originalPrice')?.value ?? 0);
    const campaignIds = normalizeProductCampaignIds({
      campaignIds: control.get('campaignIds')?.value as string[] | undefined,
    });

    if (pricingMode === 'individual_offer') {
      return offerPrice > 0 && offerPrice < originalPrice ? null : { invalidOffer: true };
    }

    if (pricingMode === 'campaign') {
      return campaignIds.length > 0 ? null : { missingCampaign: true };
    }

    if (pricingMode !== 'regular') {
      return null;
    }

    if (offerPrice < 0) {
      return null;
    }

    return null;
  }

  private campaignDateRangeValidator(control: AbstractControl): ValidationErrors | null {
    const startsAt = String(control.get('startsAt')?.value ?? '').trim();
    const endsAt = String(control.get('endsAt')?.value ?? '').trim();

    if (!startsAt || !endsAt) {
      return null;
    }

    return startsAt <= endsAt ? null : { invalidDateRange: true };
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  private showValidationError(message: string): void {
    this.feedbackMessage.set(null);
    this.errorMessage.set(message);
    this.alertsService.toast('error', message);
  }

  private getProductValidationMessage(): string {
    if (this.productForm.controls.name.invalid) {
      return 'Revisa el nombre del producto antes de guardar.';
    }

    if (this.productForm.controls.category.invalid) {
      return 'Selecciona una categoría válida antes de guardar.';
    }

    if (this.productForm.controls.position.invalid) {
      return 'El orden del producto debe ser 0 o superior.';
    }

    if (this.productForm.controls.description.invalid) {
      return 'Añade una descripción corta para el catálogo.';
    }

    if (this.productForm.controls.originalPrice.invalid) {
      return 'El precio base debe ser mayor que 0.';
    }

    if (this.productForm.controls.stock.invalid) {
      return 'El stock no puede ser negativo.';
    }

    if (this.productForm.errors?.['invalidOffer']) {
      return 'El precio en oferta debe ser mayor que 0 y menor que el precio base.';
    }

    if (this.productForm.errors?.['missingCampaign']) {
      return 'Selecciona al menos una campaña para aplicar precio de temporada.';
    }

    return 'Revisa los datos del producto antes de guardar.';
  }

  private getCampaignValidationMessage(): string {
    if (this.campaignForm.controls.name.invalid) {
      return 'El nombre de la campaña debe tener al menos 2 caracteres.';
    }

    if (this.campaignForm.controls.badge.invalid) {
      return 'El badge corto debe tener al menos 2 caracteres.';
    }

    if (this.campaignForm.controls.description.invalid) {
      return 'Añade una descripción de al menos 8 caracteres.';
    }

    if (this.campaignForm.controls.discountValue.invalid) {
      return 'El valor del descuento debe ser mayor que 0.';
    }

    if (this.campaignForm.errors?.['invalidDateRange']) {
      return 'La fecha de fin debe ser igual o posterior a la fecha de inicio.';
    }

    return 'Revisa los datos de la campaña antes de guardar.';
  }

  private getTaxonomyValidationMessage(type: 'category' | 'collection'): string {
    const form = type === 'category' ? this.categoryForm : this.collectionForm;
    const label = type === 'category' ? 'categoría' : 'colección';

    if (form.controls.name.invalid) {
      return `El nombre de la ${label} debe tener al menos 2 caracteres.`;
    }

    if (form.controls.position.invalid) {
      return `El orden de la ${label} debe ser 0 o superior.`;
    }

    return `Revisa los datos de la ${label} antes de guardar.`;
  }

  private getProductCampaignConflictMessage(draft: ProductDraft): string | null {
    if (draft.pricingMode !== 'campaign' || draft.campaignIds.length < 2) {
      return null;
    }

    const selectedCampaigns = draft.campaignIds
      .map((campaignId) => this.campaignsService.getCampaignById(campaignId))
      .filter((campaign): campaign is Campaign => !!campaign);

    for (let index = 0; index < selectedCampaigns.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < selectedCampaigns.length; compareIndex += 1) {
        const left = selectedCampaigns[index];
        const right = selectedCampaigns[compareIndex];

        if (!this.doCampaignsOverlap(left, right)) {
          continue;
        }

        return `El producto "${draft.name}" no puede tener las campañas "${left.name}" y "${right.name}" activas a la vez. Ajusta fechas o deja solo una para ese periodo.`;
      }
    }

    return null;
  }

  private getCampaignScheduleConflictMessage(draft: CampaignDraft, editingCampaignId: string | null): string | null {
    if (!editingCampaignId) {
      return null;
    }

    const draftCampaign: Campaign = {
      id: editingCampaignId,
      ...draft,
    };

    for (const product of this.productsService.productsSnapshot) {
      const assignedCampaignIds = normalizeProductCampaignIds(product);

      if (!assignedCampaignIds.includes(editingCampaignId)) {
        continue;
      }

      for (const relatedCampaignId of assignedCampaignIds) {
        if (relatedCampaignId === editingCampaignId) {
          continue;
        }

        const relatedCampaign = this.campaignsService.getCampaignById(relatedCampaignId);

        if (!relatedCampaign || !this.doCampaignsOverlap(draftCampaign, relatedCampaign)) {
          continue;
        }

        return `La campaña "${draft.name}" se solapa con "${relatedCampaign.name}" en el producto "${product.name}". No permitimos dos campañas simultáneas sobre la misma pieza.`;
      }
    }

    return null;
  }

  private doCampaignsOverlap(left: Campaign, right: Campaign): boolean {
    if (!left.active || !right.active) {
      return false;
    }

    const leftStart = left.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const leftEnd = left.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightStart = right.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightEnd = right.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;

    return leftStart <= rightEnd && rightStart <= leftEnd;
  }

  private async showCampaignConflict(message: string): Promise<void> {
    this.feedbackMessage.set(null);
    this.errorMessage.set(message);
    await this.alertsService.error('Campañas incompatibles', message);
  }

  private mergeTaxonomyOptions(
    managed: CatalogTaxonomy[],
    catalog: Array<{ slug: string; name: string }>,
  ): TaxonomyOption[] {
    const entries = new Map<string, TaxonomyOption>();

    for (const item of managed) {
      entries.set(item.slug, {
        id: item.id,
        name: item.name,
        slug: item.slug,
        position: item.position,
        source: 'managed',
      });
    }

    for (const item of catalog) {
      if (entries.has(item.slug)) {
        continue;
      }

      entries.set(item.slug, {
        id: item.slug,
        name: item.name,
        slug: item.slug,
        position: Number.MAX_SAFE_INTEGER,
        source: 'catalog',
      });
    }

    return Array.from(entries.values()).sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.name.localeCompare(right.name, 'es');
    });
  }

  private async readCurrentProducts(): Promise<Product[]> {
    return firstValueFrom(this.products$);
  }

  trackGalleryImage(index: number, imageUrl: string): string {
    return `${index}-${imageUrl}`;
  }

  setPrimaryImage(index: number): void {
    if (index <= 0) {
      return;
    }

    const gallery = [...this.galleryUrls()];
    const [imageUrl] = gallery.splice(index, 1);
    gallery.unshift(imageUrl);
    this.galleryUrls.set(gallery);
  }

  moveGalleryImage(index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;
    const gallery = [...this.galleryUrls()];

    if (targetIndex < 0 || targetIndex >= gallery.length) {
      return;
    }

    [gallery[index], gallery[targetIndex]] = [gallery[targetIndex], gallery[index]];
    this.galleryUrls.set(gallery);
  }

  removeGalleryImage(index: number): void {
    this.galleryUrls.set(this.galleryUrls().filter((_, imageIndex) => imageIndex !== index));
  }

  getNextProductPosition(): number {
    const positions = this.productsService.productsSnapshot.map((product) => product.position || 0);
    return positions.length ? Math.max(...positions) + 10 : 10;
  }

  getNextTaxonomyPosition(type: 'category' | 'collection'): number {
    const items = type === 'category'
      ? this.taxonomiesService.categoriesSnapshot
      : this.taxonomiesService.collectionsSnapshot;
    const positions = items.map((item) => item.position || 0);
    return positions.length ? Math.max(...positions) + 10 : 10;
  }
}


