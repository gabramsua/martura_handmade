import { AsyncPipe, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FirebaseError } from 'firebase/app';
import { combineLatest, map, startWith } from 'rxjs';

import { authMode } from '../../core/firebase/firebase.config';
import {
  Campaign,
  CampaignDiscountType,
  CampaignDraft,
} from '../../core/models/campaign.model';
import {
  DiscountCode,
  DiscountCodeDraft,
  DiscountCodeScope,
  DiscountCodeType,
} from '../../core/models/discount-code.model';
import {
  CheckoutOrder,
  getOrderStatusLabel,
  OrderFilters,
  OrderStatus,
} from '../../core/models/order.model';
import {
  normalizeProductCampaignIds,
  Product,
  ProductDraft,
  ProductPricingMode,
  ProductStatus,
} from '../../core/models/product.model';
import { CatalogTaxonomy } from '../../core/models/taxonomy.model';
import { HeroSlide, ShopSettings } from '../../core/models/shop-settings.model';
import { resolveProductPricing } from '../../core/utils/product-pricing';
import { slugify } from '../../core/utils/slug';
import { environment } from '../../../environments/environment';
import { AlertsService } from '../../core/services/alerts.service';
import { CampaignsService } from '../../core/services/campaigns.service';
import { DiscountCodesService } from '../../core/services/discount-codes.service';
import { MediaService } from '../../core/services/media.service';
import { OrdersService } from '../../core/services/orders.service';
import { ProductsService } from '../../core/services/products.service';
import { ShopSettingsService } from '../../core/services/shop-settings.service';
import { TaxonomiesService } from '../../core/services/taxonomies.service';

type AdminView = 'orders' | 'catalog' | 'product' | 'taxonomy' | 'promotions' | 'settings';
type CatalogSortKey = 'name' | 'position' | 'taxonomy' | 'price' | 'promo' | 'status' | 'stock';
type SortDirection = 'asc' | 'desc';

interface AdminNavItem {
  key: AdminView;
  label: string;
  caption: string;
}

@Component({
  selector: 'app-admin',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    DatePipe,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
  ],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly alertsService = inject(AlertsService);
  private readonly campaignsService = inject(CampaignsService);
  private readonly discountCodesService = inject(DiscountCodesService);
  private readonly mediaService = inject(MediaService);
  private readonly ordersService = inject(OrdersService);
  private readonly productsService = inject(ProductsService);
  private readonly shopSettingsService = inject(ShopSettingsService);
  private readonly taxonomiesService = inject(TaxonomiesService);

  readonly modeLabel = authMode === 'firebase' ? 'Firebase en vivo' : 'Modo mock';
  readonly activeView = signal<AdminView>('orders');
  readonly editingProductId = signal<string | null>(null);
  readonly editingCampaignId = signal<string | null>(null);
  readonly editingDiscountCodeId = signal<string | null>(null);
  readonly editingCategoryId = signal<string | null>(null);
  readonly editingSubcategoryId = signal<string | null>(null);
  readonly editingCollectionId = signal<string | null>(null);
  readonly feedbackMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly isSavingProduct = signal(false);
  readonly isSavingCampaign = signal(false);
  readonly isSavingDiscountCode = signal(false);
  readonly isSavingSettings = signal(false);
  readonly isSavingCategory = signal(false);
  readonly isSavingSubcategory = signal(false);
  readonly isSavingCollection = signal(false);
  readonly isUploadingImage = signal(false);
  readonly activeProductActionId = signal<string | null>(null);
  readonly activeCampaignActionId = signal<string | null>(null);
  readonly activeDiscountCodeActionId = signal<string | null>(null);
  readonly activeOrderActionId = signal<string | null>(null);
  readonly galleryUrls = signal<string[]>([]);
  readonly heroSlides = signal<HeroSlide[]>([]);
  readonly activeHeroUploadId = signal<string | null>(null);
  readonly catalogSort = signal<{ key: CatalogSortKey; direction: SortDirection }>({
    key: 'position',
    direction: 'asc',
  });
  readonly adminEmailHint = environment.firebase.adminEmails[0] ?? 'correo administrador';
  readonly catalogSort$ = toObservable(this.catalogSort);

  readonly navItems: AdminNavItem[] = [
    { key: 'orders', label: 'Pedidos', caption: 'Flujo de fabricación y entrega' },
    { key: 'catalog', label: 'Catálogo', caption: 'Listado, stock y orden' },
    { key: 'product', label: 'Producto', caption: 'Alta y edición' },
    { key: 'taxonomy', label: 'Taxonomías', caption: 'Categorías, subcategorías y colecciones' },
    { key: 'promotions', label: 'Promociones', caption: 'Campañas, ofertas y códigos' },
    { key: 'settings', label: 'Ajustes', caption: 'Bizum, envíos, sobre mí y carrusel' },
  ];
  readonly currentView = computed(
    () => this.navItems.find((item) => item.key === this.activeView()) ?? this.navItems[0],
  );
  readonly currentHeading = computed(() => {
    if (this.activeView() === 'product') {
      return this.editingProductId() ? 'Editar producto' : 'Nuevo producto';
    }

    return this.currentView().label;
  });

  readonly pricingOptions: Array<{ value: ProductPricingMode; label: string }> = [
    { value: 'regular', label: 'Precio normal' },
    { value: 'individual_offer', label: 'Oferta individual' },
    { value: 'campaign', label: 'Campaña' },
  ];
  readonly productStatusOptions: Array<{ value: ProductStatus; label: string }> = [
    { value: 'active', label: 'Activo' },
    { value: 'sold_out', label: 'Agotado' },
    { value: 'hidden', label: 'Oculto' },
  ];
  readonly campaignDiscountTypeOptions: Array<{ value: CampaignDiscountType; label: string }> = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed', label: 'Importe fijo' },
  ];
  readonly discountCodeTypeOptions: Array<{ value: DiscountCodeType; label: string }> = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed', label: 'Importe fijo' },
  ];
  readonly discountCodeScopeOptions: Array<{ value: DiscountCodeScope; label: string }> = [
    { value: 'all', label: 'Todo el catálogo' },
    { value: 'products', label: 'Productos concretos' },
  ];
  readonly orderStatusOptions: Array<{ value: OrderFilters['status']; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'in_factory', label: 'En fábrica' },
    { value: 'accepted', label: 'Aceptado' },
    { value: 'shipped', label: 'Enviado' },
    { value: 'delivered', label: 'Entregado' },
    { value: 'cancelled', label: 'Cancelado' },
  ];

  readonly products$ = this.productsService.products$;
  readonly orders$ = this.ordersService.orders$;
  readonly categories$ = this.productsService.categories$;
  readonly subcategories$ = this.productsService.subcategories$;
  readonly collections$ = this.productsService.collections$;
  readonly managedCategories$ = this.taxonomiesService.categories$;
  readonly managedSubcategories$ = this.taxonomiesService.subcategories$;
  readonly managedCollections$ = this.taxonomiesService.collections$;
  readonly campaigns$ = this.campaignsService.campaigns$;
  readonly discountCodes$ = this.discountCodesService.discountCodes$;
  readonly settings$ = this.shopSettingsService.settings$;

  readonly orderFiltersForm = this.formBuilder.nonNullable.group({
    status: ['all' as OrderFilters['status']],
    query: [''],
    dateFrom: [''],
    dateTo: [''],
  });
  readonly catalogFiltersForm = this.formBuilder.nonNullable.group({
    query: [''],
  });
  readonly productForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    category: ['', [Validators.required]],
    subcategory: [''],
    collection: [''],
    position: [10, [Validators.required, Validators.min(0)]],
    description: ['', [Validators.required, Validators.minLength(8)]],
    story: [''],
    originalPrice: [0, [Validators.required, Validators.min(1)]],
    pricingMode: ['regular' as ProductPricingMode, [Validators.required]],
    offerPrice: [0, [Validators.min(0)]],
    campaignIds: [[] as string[]],
    stock: [1, [Validators.required, Validators.min(0)]],
    status: ['active' as ProductStatus, [Validators.required]],
    sizes: [''],
    colors: [''],
    featured: [false],
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
  readonly discountCodeForm = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(3)]],
    description: ['', [Validators.required, Validators.minLength(4)]],
    type: ['percentage' as DiscountCodeType, [Validators.required]],
    value: [10, [Validators.required, Validators.min(1)]],
    active: [true],
    scope: ['all' as DiscountCodeScope, [Validators.required]],
    productIds: [[] as string[]],
    startsAt: [''],
    endsAt: [''],
  });
  readonly categoryForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    position: [10, [Validators.required, Validators.min(0)]],
  });
  readonly subcategoryForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    position: [10, [Validators.required, Validators.min(0)]],
  });
  readonly collectionForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    position: [10, [Validators.required, Validators.min(0)]],
  });
  readonly settingsForm = this.formBuilder.nonNullable.group({
    bizumPhone: ['', [Validators.required, Validators.pattern(/^[0-9+\s]{9,15}$/)]],
    shippingPrice: [4.95, [Validators.required, Validators.min(0)]],
    contactEmail: ['', [Validators.required, Validators.email]],
    aboutTitle: ['', [Validators.required, Validators.minLength(4)]],
    aboutBody: ['', [Validators.required, Validators.minLength(20)]],
    hero1ImageUrl: [''],
    hero1Headline: [''],
    hero1Caption: [''],
    hero1Active: [true],
    hero2ImageUrl: [''],
    hero2Headline: [''],
    hero2Caption: [''],
    hero2Active: [true],
    hero3ImageUrl: [''],
    hero3Headline: [''],
    hero3Caption: [''],
    hero3Active: [true],
  });

  readonly filteredOrders$ = combineLatest([
    this.orders$,
    this.orderFiltersForm.valueChanges.pipe(startWith(this.orderFiltersForm.getRawValue())),
  ]).pipe(
    map(([orders, filters]) => {
      const query = (filters.query ?? '').trim().toLowerCase();
      const dateFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`) : null;
      const dateTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`) : null;

      return [...orders]
        .filter((order) => {
          const matchesStatus = filters.status === 'all' || order.status === filters.status;
          const matchesDate =
            (!dateFrom || order.createdAt >= dateFrom) &&
            (!dateTo || order.createdAt <= dateTo);
          const matchesQuery =
            !query ||
            order.id.toLowerCase().includes(query) ||
            order.customer.name.toLowerCase().includes(query) ||
            order.customer.email.toLowerCase().includes(query) ||
            order.customer.phone.toLowerCase().includes(query) ||
            order.customer.dni.toLowerCase().includes(query) ||
            order.items.some((item) => item.productName.toLowerCase().includes(query));

          return matchesStatus && matchesDate && matchesQuery;
        })
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    }),
  );

  readonly filteredCatalogProducts$ = combineLatest([
    this.products$,
    this.catalogFiltersForm.valueChanges.pipe(startWith(this.catalogFiltersForm.getRawValue())),
    this.campaignsService.activeCampaigns$,
    this.catalogSort$,
  ]).pipe(
    map(([products, filters, _, sort]) => {
      const query = (filters.query ?? '').trim().toLowerCase();
      const filteredProducts = !query
        ? products
        : products.filter((product) =>
            [
              product.name,
              product.category,
              product.subcategory ?? '',
              product.collection ?? '',
              product.status,
              product.slug,
            ]
              .join(' ')
              .toLowerCase()
              .includes(query),
          );

      return [...filteredProducts].sort((left, right) =>
        this.compareCatalogProducts(left, right, sort.key, sort.direction),
      );
    }),
  );

  constructor() {
    this.settings$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => this.patchSettingsForm(settings));

    this.managedCategories$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.editingCategoryId()) {
          this.resetTaxonomyForm('category', false);
        }
      });

    this.managedSubcategories$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.editingSubcategoryId()) {
          this.resetTaxonomyForm('subcategory', false);
        }
      });

    this.managedCollections$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.editingCollectionId()) {
          this.resetTaxonomyForm('collection', false);
        }
      });
  }

  setView(view: AdminView): void {
    this.activeView.set(view);
  }

  isNavActive(view: AdminView): boolean {
    if (this.activeView() === view) {
      return true;
    }

    return view === 'catalog' && this.activeView() === 'product' && !!this.editingProductId();
  }

  toggleCatalogSort(key: CatalogSortKey): void {
    const currentSort = this.catalogSort();

    if (currentSort.key === key) {
      this.catalogSort.set({
        key,
        direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
      });
      return;
    }

    this.catalogSort.set({
      key,
      direction: key === 'position' || key === 'price' || key === 'stock' ? 'desc' : 'asc',
    });
  }

  getCatalogSortDirection(key: CatalogSortKey): SortDirection | null {
    const currentSort = this.catalogSort();
    return currentSort.key === key ? currentSort.direction : null;
  }

  getCatalogSortLabel(key: CatalogSortKey): string {
    const direction = this.getCatalogSortDirection(key);
    return direction ? (direction === 'asc' ? '↑' : '↓') : '';
  }

  async saveProduct(): Promise<void> {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      this.showValidationError('Revisa la ficha del producto antes de guardar.');
      return;
    }

    if (!this.galleryUrls().length) {
      this.showValidationError('Sube al menos una imagen antes de guardar el producto.');
      return;
    }

    const draft = this.formToProductDraft();
    const editingProductId = this.editingProductId();
    const conflictMessage = this.getProductCampaignConflictMessage(draft);

    if (conflictMessage) {
      await this.alertsService.error('Campañas incompatibles', conflictMessage);
      return;
    }

    const duplicatePositionProduct = this.productsService.productsSnapshot.find(
      (product) => product.position === draft.position && product.id !== editingProductId,
    );

    if (duplicatePositionProduct) {
      const shouldKeepDuplicatePosition = await this.alertsService.confirm({
        title: 'Ese orden ya existe',
        text: `"${duplicatePositionProduct.name}" ya usa la posición ${draft.position}. Si continúas, ambos productos compartirán ese orden.`,
        confirmButtonText: 'Mantener el mismo orden',
        cancelButtonText: 'Cancelar y revisar',
        icon: 'question',
      });

      if (!shouldKeepDuplicatePosition) {
        return;
      }
    }

    try {
      this.isSavingProduct.set(true);
      this.clearMessages();

      if (editingProductId) {
        await this.productsService.updateProduct(editingProductId, draft);
        this.setSuccess('Producto actualizado correctamente.');
      } else {
        await this.productsService.createProduct(draft);
        this.setSuccess('Producto creado correctamente.');
      }

      this.resetProductForm(false);
      this.activeView.set('catalog');
    } catch (error) {
      this.setError(error, 'No se pudo guardar el producto.');
    } finally {
      this.isSavingProduct.set(false);
    }
  }

  editProduct(product: Product): void {
    this.clearMessages();
    this.editingProductId.set(product.id);
    this.galleryUrls.set(product.gallery.length ? product.gallery : [product.imageUrl]);
    this.productForm.setValue({
      name: product.name,
      category: product.category,
      subcategory: product.subcategory ?? '',
      collection: product.collection ?? '',
      position: product.position,
      description: product.description,
      story: product.story,
      originalPrice: product.originalPrice,
      pricingMode: product.pricingMode,
      offerPrice: product.offerPrice ?? 0,
      campaignIds: normalizeProductCampaignIds(product),
      stock: product.stock,
      status: product.status,
      sizes: product.sizes.join(', '),
      colors: product.colors.join(', '),
      featured: product.featured,
    });
    this.activeView.set('product');
  }

  resetProductForm(clearMessages = true): void {
    this.editingProductId.set(null);
    this.galleryUrls.set([]);

    if (clearMessages) {
      this.clearMessages();
    }

    this.productForm.reset({
      name: '',
      category: this.taxonomiesService.categoriesSnapshot[0]?.name ?? '',
      subcategory: '',
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
      sizes: '',
      colors: '',
      featured: false,
    });
  }

  async deleteProduct(productId: string): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Borrar producto',
      text: 'Se eliminará la ficha y sus imágenes asociadas. ¿Quieres continuar?',
      confirmButtonText: 'Borrar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeProductActionId.set(productId);
      this.clearMessages();
      await this.productsService.deleteProduct(productId);
      this.setSuccess('Producto eliminado correctamente.');

      if (this.editingProductId() === productId) {
        this.resetProductForm(false);
      }
    } catch (error) {
      this.setError(error, 'No se pudo borrar el producto.');
    } finally {
      this.activeProductActionId.set(null);
    }
  }

  async uploadImages(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];

    if (!files.length) {
      return;
    }

    try {
      this.isUploadingImage.set(true);
      this.clearMessages();
      const uploadedUrls: string[] = [];

      for (const file of files) {
        uploadedUrls.push(await this.mediaService.uploadProductImage(file));
      }

      this.galleryUrls.set([...this.galleryUrls(), ...uploadedUrls]);
      this.setSuccess(`${uploadedUrls.length} imagen(es) subida(s) correctamente.`);
    } catch (error) {
      this.setError(error, 'No se pudieron subir las imágenes.');
    } finally {
      this.isUploadingImage.set(false);

      if (input) {
        input.value = '';
      }
    }
  }

  removeGalleryImage(index: number): void {
    this.galleryUrls.set(this.galleryUrls().filter((_, imageIndex) => imageIndex !== index));
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
    const nextIndex = index + direction;
    const gallery = [...this.galleryUrls()];

    if (nextIndex < 0 || nextIndex >= gallery.length) {
      return;
    }

    [gallery[index], gallery[nextIndex]] = [gallery[nextIndex], gallery[index]];
    this.galleryUrls.set(gallery);
  }

  addHeroSlide(): void {
    this.heroSlides.set(
      this.reindexHeroSlides([
        ...this.heroSlides(),
        {
          id: `hero-${Date.now()}`,
          imageUrl: '',
          headline: '',
          caption: '',
          position: 0,
          active: true,
        },
      ]),
    );
  }

  updateHeroSlideField(index: number, field: 'caption' | 'headline', value: string): void {
    const slides = [...this.heroSlides()];
    const slide = slides[index];

    if (!slide) {
      return;
    }

    slides[index] = {
      ...slide,
      [field]: value,
    };

    this.heroSlides.set(slides);
  }

  toggleHeroSlideActive(index: number, active: boolean): void {
    const slides = [...this.heroSlides()];
    const slide = slides[index];

    if (!slide) {
      return;
    }

    slides[index] = {
      ...slide,
      active,
    };

    this.heroSlides.set(slides);
  }

  async uploadHeroSlideImage(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    const slide = this.heroSlides()[index] ?? null;

    if (!file || !slide) {
      return;
    }

    try {
      this.activeHeroUploadId.set(slide.id);
      this.clearMessages();
      const imageUrl = await this.mediaService.uploadHeroSlideImage(file);
      const slides = [...this.heroSlides()];
      slides[index] = {
        ...slide,
        imageUrl,
      };
      this.heroSlides.set(slides);
      this.setSuccess('Imagen del slide subida correctamente.');
    } catch (error) {
      this.setError(error, 'No se pudo subir la imagen del slide.');
    } finally {
      this.activeHeroUploadId.set(null);

      if (input) {
        input.value = '';
      }
    }
  }

  moveHeroSlide(index: number, direction: -1 | 1): void {
    const nextIndex = index + direction;
    const slides = [...this.heroSlides()];

    if (nextIndex < 0 || nextIndex >= slides.length) {
      return;
    }

    [slides[index], slides[nextIndex]] = [slides[nextIndex], slides[index]];
    this.heroSlides.set(this.reindexHeroSlides(slides));
  }

  removeHeroSlide(index: number): void {
    this.heroSlides.set(this.reindexHeroSlides(this.heroSlides().filter((_, slideIndex) => slideIndex !== index)));
  }

  async saveCampaign(): Promise<void> {
    if (this.campaignForm.invalid) {
      this.campaignForm.markAllAsTouched();
      this.showValidationError('Revisa la campaña antes de guardarla.');
      return;
    }

    const draft = this.formToCampaignDraft();

    try {
      this.isSavingCampaign.set(true);
      this.clearMessages();

      if (this.editingCampaignId()) {
        await this.campaignsService.updateCampaign(this.editingCampaignId()!, draft);
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

  editCampaign(campaign: Campaign): void {
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

  async deleteCampaign(campaignId: string): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Borrar campaña',
      text: 'Se eliminará la campaña y dejará de aplicarse a los productos enlazados.',
      confirmButtonText: 'Borrar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeCampaignActionId.set(campaignId);
      this.clearMessages();
      await this.campaignsService.deleteCampaign(campaignId);
      this.setSuccess('Campaña eliminada correctamente.');

      if (this.editingCampaignId() === campaignId) {
        this.resetCampaignForm(false);
      }
    } catch (error) {
      this.setError(error, 'No se pudo borrar la campaña.');
    } finally {
      this.activeCampaignActionId.set(null);
    }
  }

  async saveDiscountCode(): Promise<void> {
    if (this.discountCodeForm.invalid) {
      this.discountCodeForm.markAllAsTouched();
      this.showValidationError('Revisa el código de descuento antes de guardarlo.');
      return;
    }

    if (this.discountCodeForm.controls.scope.value === 'products' && !this.discountCodeForm.controls.productIds.value.length) {
      this.showValidationError('Selecciona al menos un producto para un código limitado.');
      return;
    }

    const draft = this.formToDiscountCodeDraft();

    try {
      this.isSavingDiscountCode.set(true);
      this.clearMessages();

      if (this.editingDiscountCodeId()) {
        await this.discountCodesService.updateDiscountCode(this.editingDiscountCodeId()!, draft);
        this.setSuccess('Código actualizado correctamente.');
      } else {
        await this.discountCodesService.createDiscountCode(draft);
        this.setSuccess('Código creado correctamente.');
      }

      this.resetDiscountCodeForm(false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar el código de descuento.');
    } finally {
      this.isSavingDiscountCode.set(false);
    }
  }

  editDiscountCode(discountCode: DiscountCode): void {
    this.editingDiscountCodeId.set(discountCode.id);
    this.discountCodeForm.setValue({
      code: discountCode.code,
      description: discountCode.description,
      type: discountCode.type,
      value: discountCode.value,
      active: discountCode.active,
      scope: discountCode.scope,
      productIds: discountCode.productIds,
      startsAt: this.formatDateInput(discountCode.startsAt),
      endsAt: this.formatDateInput(discountCode.endsAt),
    });
  }

  resetDiscountCodeForm(clearMessages = true): void {
    this.editingDiscountCodeId.set(null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.discountCodeForm.reset({
      code: '',
      description: '',
      type: 'percentage',
      value: 10,
      active: true,
      scope: 'all',
      productIds: [],
      startsAt: '',
      endsAt: '',
    });
  }

  async deleteDiscountCode(discountCodeId: string): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Borrar código',
      text: 'Se eliminará el código y dejará de validarse en checkout.',
      confirmButtonText: 'Borrar',
    });

    if (!confirmed) {
      return;
    }

    try {
      this.activeDiscountCodeActionId.set(discountCodeId);
      this.clearMessages();
      await this.discountCodesService.deleteDiscountCode(discountCodeId);
      this.setSuccess('Código eliminado correctamente.');

      if (this.editingDiscountCodeId() === discountCodeId) {
        this.resetDiscountCodeForm(false);
      }
    } catch (error) {
      this.setError(error, 'No se pudo borrar el código.');
    } finally {
      this.activeDiscountCodeActionId.set(null);
    }
  }

  async saveTaxonomy(type: 'category' | 'subcategory' | 'collection'): Promise<void> {
    const form = this.getTaxonomyForm(type);
    const editingId = this.getEditingTaxonomyId(type);

    if (form.invalid) {
      form.markAllAsTouched();
      this.showValidationError('Revisa el nombre y la posición antes de guardar.');
      return;
    }

    const draft = form.getRawValue();

    try {
      this.setTaxonomySaving(type, true);
      this.clearMessages();

      if (editingId) {
        await this.taxonomiesService.updateTaxonomy(type, editingId, draft);

        const previousItem = this.getTaxonomySnapshot(type).find((item) => item.id === editingId) ?? null;

        if (previousItem) {
          await this.productsService.replaceTaxonomyReference(type, previousItem.slug, {
            name: draft.name,
            slug: slugify(draft.name),
          });
        }

        this.setSuccess('Taxonomía actualizada correctamente.');
      } else {
        await this.taxonomiesService.createTaxonomy(type, draft);
        this.setSuccess('Taxonomía creada correctamente.');
      }

      this.resetTaxonomyForm(type, false);
    } catch (error) {
      this.setError(error, 'No se pudo guardar la taxonomía.');
    } finally {
      this.setTaxonomySaving(type, false);
    }
  }

  editTaxonomy(type: 'category' | 'subcategory' | 'collection', taxonomy: CatalogTaxonomy): void {
    this.setEditingTaxonomyId(type, taxonomy.id);
    this.getTaxonomyForm(type).setValue({
      name: taxonomy.name,
      position: taxonomy.position,
    });
  }

  resetTaxonomyForm(type: 'category' | 'subcategory' | 'collection', clearMessages = true): void {
    this.setEditingTaxonomyId(type, null);

    if (clearMessages) {
      this.clearMessages();
    }

    this.getTaxonomyForm(type).reset({
      name: '',
      position: this.getNextTaxonomyPosition(type),
    });
  }

  async deleteTaxonomy(type: 'category' | 'subcategory' | 'collection', taxonomyId: string): Promise<void> {
    const confirmed = await this.alertsService.confirm({
      title: 'Borrar taxonomía',
      text: 'Seguirá existiendo en productos históricos si no se reasigna manualmente.',
      confirmButtonText: 'Borrar',
    });

    if (!confirmed) {
      return;
    }

    try {
      await this.taxonomiesService.deleteTaxonomy(type, taxonomyId);
      this.setSuccess('Taxonomía eliminada correctamente.');
      this.resetTaxonomyForm(type, false);
    } catch (error) {
      this.setError(error, 'No se pudo borrar la taxonomía.');
    }
  }

  async saveSettings(): Promise<void> {
    if (this.settingsForm.invalid) {
      this.settingsForm.markAllAsTouched();
      this.showValidationError('Revisa los ajustes generales antes de guardar.');
      return;
    }

    let settingsDraft: ShopSettings;

    try {
      settingsDraft = this.formToSettingsDraft();
    } catch (error) {
      this.showValidationError(
        error instanceof Error ? error.message : 'Revisa los slides del carrusel antes de guardar.',
      );
      return;
    }

    try {
      this.isSavingSettings.set(true);
      this.clearMessages();
      await this.shopSettingsService.saveSettings(settingsDraft);
      this.setSuccess('Ajustes guardados correctamente.');
    } catch (error) {
      this.setError(error, 'No se pudieron guardar los ajustes.');
    } finally {
      this.isSavingSettings.set(false);
    }
  }

  async updateOrderStatus(order: CheckoutOrder, status: OrderStatus): Promise<void> {
    try {
      this.activeOrderActionId.set(order.id);
      this.clearMessages();
      await this.ordersService.updateStatus(order.id, status);
      this.setSuccess(`Pedido actualizado a "${getOrderStatusLabel(status)}".`);
    } catch (error) {
      this.setError(error, 'No se pudo actualizar el pedido.');
    } finally {
      this.activeOrderActionId.set(null);
    }
  }

  getOrderProgressActions(order: CheckoutOrder): Array<{ label: string; status: OrderStatus }> {
    switch (order.status) {
      case 'in_factory':
        return [{ label: 'Marcar aceptado', status: 'accepted' }];
      case 'accepted':
        return [{ label: 'Marcar enviado', status: 'shipped' }];
      case 'shipped':
        return [{ label: 'Marcar entregado', status: 'delivered' }];
      case 'cancelled':
        return [{ label: 'Reabrir en fábrica', status: 'in_factory' }];
      default:
        return [];
    }
  }

  canCancelOrder(order: CheckoutOrder): boolean {
    return order.status !== 'cancelled' && order.status !== 'delivered';
  }

  getProductTaxonomy(product: Product): string {
    return [product.category, product.subcategory, product.collection].filter(Boolean).join(' · ');
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

  getOrderStatusLabel(order: CheckoutOrder): string {
    return getOrderStatusLabel(order.status);
  }

  getCampaignLifecycleLabel(campaign: Campaign): string {
    switch (this.campaignsService.getCampaignLifecycle(campaign)) {
      case 'active':
        return 'Activa';
      case 'scheduled':
        return 'Programada';
      case 'ended':
        return 'Finalizada';
      case 'inactive':
      default:
        return 'Pausada';
    }
  }

  private formToProductDraft(): ProductDraft {
    const value = this.productForm.getRawValue();
    const sizes = this.commaListToArray(value.sizes);

    return {
      name: value.name.trim(),
      position: value.position,
      description: value.description.trim(),
      story: value.story.trim(),
      originalPrice: value.originalPrice,
      offerPrice:
        value.pricingMode === 'individual_offer' && value.offerPrice > 0
          ? value.offerPrice
          : null,
      imageUrl: this.galleryUrls()[0] ?? '',
      gallery: this.galleryUrls(),
      category: value.category,
      categorySlug: slugify(value.category),
      subcategory: value.subcategory.trim() || null,
      subcategorySlug: value.subcategory.trim() ? slugify(value.subcategory) : null,
      collection: value.collection.trim() || null,
      collectionSlug: value.collection.trim() ? slugify(value.collection) : null,
      stock: value.stock,
      sizes,
      colors: this.commaListToArray(value.colors),
      pricingMode: value.pricingMode,
      campaignIds:
        value.pricingMode === 'campaign'
          ? normalizeProductCampaignIds({ campaignIds: value.campaignIds })
          : [],
      featured: value.featured,
      status: value.status,
    };
  }

  private formToCampaignDraft(): CampaignDraft {
    const value = this.campaignForm.getRawValue();

    return {
      name: value.name.trim(),
      badge: value.badge.trim(),
      description: value.description.trim(),
      discountType: value.discountType,
      discountValue: value.discountValue,
      active: value.active,
      startsAt: value.startsAt ? new Date(value.startsAt) : null,
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
    };
  }

  private formToDiscountCodeDraft(): DiscountCodeDraft {
    const value = this.discountCodeForm.getRawValue();

    return {
      code: value.code.trim().toUpperCase(),
      description: value.description.trim(),
      type: value.type,
      value: value.value,
      active: value.active,
      scope: value.scope,
      productIds: value.scope === 'products' ? value.productIds : [],
      startsAt: value.startsAt ? new Date(value.startsAt) : null,
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
    };
  }

  private formToSettingsDraft(): ShopSettings {
    const value = this.settingsForm.getRawValue();

    return {
      id: this.shopSettingsService.settingsSnapshot.id,
      bizumPhone: value.bizumPhone.trim(),
      shippingPrice: value.shippingPrice,
      contactEmail: value.contactEmail.trim(),
      aboutTitle: value.aboutTitle.trim(),
      aboutBody: value.aboutBody.trim(),
      heroSlides: this.buildHeroSlidesFromForm(),
    };
  }

  private buildHeroSlidesFromForm(): HeroSlide[] {
    const slides = this.reindexHeroSlides(
      this.heroSlides().map((slide) => ({
        ...slide,
        imageUrl: slide.imageUrl.trim(),
        headline: slide.headline.trim(),
        caption: slide.caption.trim(),
      })),
    );
    const hasIncompleteSlide = slides.some((slide) => {
      const filledFields = [slide.imageUrl, slide.headline, slide.caption].filter(Boolean).length;
      return filledFields > 0 && filledFields < 3;
    });

    if (hasIncompleteSlide) {
      throw new Error('Cada slide debe tener imagen, titular y texto, o quedarse completamente vacío.');
    }

    return slides.filter((slide) => slide.imageUrl && slide.headline && slide.caption);
  }

  private patchSettingsForm(settings: ShopSettings): void {
    this.settingsForm.patchValue({
      bizumPhone: settings.bizumPhone,
      shippingPrice: settings.shippingPrice,
      contactEmail: settings.contactEmail,
      aboutTitle: settings.aboutTitle,
      aboutBody: settings.aboutBody,
    }, { emitEvent: false });

    this.heroSlides.set(
      this.reindexHeroSlides(
        settings.heroSlides.length
          ? settings.heroSlides.map((slide) => ({ ...slide }))
          : [],
      ),
    );
  }

  private compareCatalogProducts(
    left: Product,
    right: Product,
    key: CatalogSortKey,
    direction: SortDirection,
  ): number {
    const factor = direction === 'asc' ? 1 : -1;

    switch (key) {
      case 'name':
        return factor * left.name.localeCompare(right.name, 'es');
      case 'position':
        return factor * (left.position - right.position || left.name.localeCompare(right.name, 'es'));
      case 'taxonomy':
        return factor * this.getProductTaxonomy(left).localeCompare(this.getProductTaxonomy(right), 'es');
      case 'price':
        return factor * (this.getProductPrice(left) - this.getProductPrice(right) || left.name.localeCompare(right.name, 'es'));
      case 'promo':
        return factor * ((this.getProductPricingBadge(left) ?? '').localeCompare(this.getProductPricingBadge(right) ?? '', 'es'));
      case 'status':
        return factor * left.status.localeCompare(right.status, 'es');
      case 'stock':
        return factor * (left.stock - right.stock || left.name.localeCompare(right.name, 'es'));
      default:
        return 0;
    }
  }

  private getProductCampaignConflictMessage(draft: ProductDraft): string | null {
    if (draft.pricingMode !== 'campaign') {
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

        return `El producto "${draft.name}" no puede tener activas al mismo tiempo las campañas "${left.name}" y "${right.name}".`;
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

  private getTaxonomyForm(type: 'category' | 'subcategory' | 'collection') {
    return type === 'category'
      ? this.categoryForm
      : type === 'subcategory'
        ? this.subcategoryForm
        : this.collectionForm;
  }

  private getEditingTaxonomyId(type: 'category' | 'subcategory' | 'collection'): string | null {
    return type === 'category'
      ? this.editingCategoryId()
      : type === 'subcategory'
        ? this.editingSubcategoryId()
        : this.editingCollectionId();
  }

  private setEditingTaxonomyId(type: 'category' | 'subcategory' | 'collection', value: string | null): void {
    if (type === 'category') {
      this.editingCategoryId.set(value);
      return;
    }

    if (type === 'subcategory') {
      this.editingSubcategoryId.set(value);
      return;
    }

    this.editingCollectionId.set(value);
  }

  private getTaxonomySnapshot(type: 'category' | 'subcategory' | 'collection'): CatalogTaxonomy[] {
    return type === 'category'
      ? this.taxonomiesService.categoriesSnapshot
      : type === 'subcategory'
        ? this.taxonomiesService.subcategoriesSnapshot
        : this.taxonomiesService.collectionsSnapshot;
  }

  private getNextTaxonomyPosition(type: 'category' | 'subcategory' | 'collection'): number {
    const items = this.getTaxonomySnapshot(type);
    return items.length ? Math.max(...items.map((item) => item.position || 0)) + 10 : 10;
  }

  private getNextProductPosition(): number {
    const positions = this.productsService.productsSnapshot.map((product) => product.position || 0);
    return positions.length ? Math.max(...positions) + 10 : 10;
  }

  private setTaxonomySaving(type: 'category' | 'subcategory' | 'collection', value: boolean): void {
    if (type === 'category') {
      this.isSavingCategory.set(value);
      return;
    }

    if (type === 'subcategory') {
      this.isSavingSubcategory.set(value);
      return;
    }

    this.isSavingCollection.set(value);
  }

  private commaListToArray(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private showValidationError(message: string): void {
    this.errorMessage.set(message);
    this.feedbackMessage.set(null);
    this.alertsService.toast('error', message);
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
    const message = this.mapAdminError(error, fallback);
    this.errorMessage.set(message);
    this.feedbackMessage.set(null);
    this.alertsService.toast('error', message);
  }

  private mapAdminError(error: unknown, fallback: string): string {
    const message =
      error instanceof Error && error.message
        ? error.message
        : typeof error === 'object' && error && 'message' in error
          ? String(error.message)
          : fallback;
    const code =
      error instanceof FirebaseError
        ? error.code
        : typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : null;

    if (
      code === 'permission-denied' ||
      code === 'storage/unauthorized' ||
      code === 'functions/permission-denied' ||
      /insufficient permissions/i.test(message)
    ) {
      return `Firebase está rechazando la escritura. Comprueba que has iniciado sesión con ${this.adminEmailHint} y que las reglas de Firestore y Storage están desplegadas en el proyecto correcto.`;
    }

    return message;
  }

  private formatDateInput(value: Date | null): string {
    if (!value) {
      return '';
    }

    return value.toISOString().slice(0, 10);
  }

  private reindexHeroSlides(slides: HeroSlide[]): HeroSlide[] {
    return slides.map((slide, index) => ({
      ...slide,
      position: (index + 1) * 10,
    }));
  }
}
