import { initializeApp } from 'firebase-admin/app';
import { DocumentReference, getFirestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const db = getFirestore();
const SHIPPING_PRICE = 4.95;
const FREE_SHIPPING_THRESHOLD = 75;
const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  'gabramsua@gmail.com'
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

type DeliveryMethod = 'shipping' | 'pickup';
type ProductStatus = 'active' | 'sold_out' | 'hidden';
type ProductPricingMode = 'regular' | 'individual_offer' | 'campaign';
type OrderStatus = 'new' | 'confirmed' | 'prepared' | 'completed' | 'cancelled';
type CampaignDiscountType = 'percentage' | 'fixed';

interface CustomerContact {
  name: string;
  email: string;
  phone: string;
  deliveryMethod: DeliveryMethod;
  addressLine1: string | null;
  postalCode: string;
  city: string;
  province: string;
  notes: string | null;
}

interface OrderRequestItem {
  productId: string;
  quantity: number;
  variant: string;
}

interface OrderItem {
  productId: string;
  productName: string;
  imageUrl: string;
  category?: string | null;
  categorySlug?: string | null;
  collection?: string | null;
  collectionSlug?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  quantity: number;
  variant: string;
  unitPrice: number;
  lineTotal: number;
}

interface CheckoutOrder {
  id: string;
  userId: string;
  customer: CustomerContact;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  channel: 'whatsapp';
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface CustomerProfile {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  deliveryMethodPreference: DeliveryMethod | null;
  addressLine1: string | null;
  postalCode: string;
  city: string;
  province: string;
  notes: string | null;
  totalOrders: number;
  totalSpent: number;
  lastOrderId: string | null;
  lastOrderStatus: OrderStatus | null;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SerializedCheckoutOrder extends Omit<CheckoutOrder, 'createdAt' | 'updatedAt'> {
  createdAt: string;
  updatedAt: string;
}

interface CreateOrderPayload {
  customer: CustomerContact;
  items: OrderRequestItem[];
}

interface UpdateOrderStatusPayload {
  orderId: string;
  status: OrderStatus;
}

interface SeedDemoCatalogResult {
  productsSeeded: number;
  campaignsSeeded: number;
}

interface RebuildCustomerProfilesResult {
  customersSynced: number;
}

interface StoredProduct {
  name?: string;
  imageUrl?: string;
  category?: string;
  categorySlug?: string;
  collection?: string | null;
  collectionSlug?: string | null;
  originalPrice?: number;
  offerPrice?: number | null;
  pricingMode?: ProductPricingMode;
  campaignIds?: string[];
  campaignId?: string | null;
  status?: ProductStatus;
  stock?: number;
}

interface StoredCampaign {
  name?: string;
  badge?: string;
  discountType?: CampaignDiscountType;
  discountValue?: number;
  active?: boolean;
  startsAt?: Timestamp | Date | null;
  endsAt?: Timestamp | Date | null;
}

interface CampaignPricing {
  name: string;
  badge: string;
  discountType: CampaignDiscountType;
  discountValue: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

interface AppliedCampaignPricing {
  id: string;
  name: string | null;
  effectivePrice: number;
}

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['prepared', 'cancelled'],
  prepared: ['completed', 'cancelled'],
  completed: [],
  cancelled: ['new'],
};

export const seedDemoCatalog = onCall<Record<string, never>, Promise<SeedDemoCatalogResult>>(async () => {
  assertFunctionsEmulator();

  return db.runTransaction(async (transaction: Transaction) => {
    const productsCollection = db.collection('products');
    const campaignsCollection = db.collection('campaigns');
    const [productsSnapshot, campaignsSnapshot] = await Promise.all([
      transaction.get(productsCollection),
      transaction.get(campaignsCollection),
    ]);

    let productsSeeded = 0;
    let campaignsSeeded = 0;

    if (productsSnapshot.empty) {
      for (const product of DEMO_PRODUCTS) {
        transaction.set(productsCollection.doc(product.id), product);
        productsSeeded += 1;
      }
    }

    if (campaignsSnapshot.empty) {
      for (const campaign of DEMO_CAMPAIGNS) {
        transaction.set(campaignsCollection.doc(campaign.id), campaign);
        campaignsSeeded += 1;
      }
    }

    return { productsSeeded, campaignsSeeded };
  });
});

export const createOrder = onCall<CreateOrderPayload>(async (request: CallableRequest<CreateOrderPayload>) => {
  const auth = assertAuthenticated(request.auth);
  const customer = normalizeCustomer(request.data?.customer);
  const items = normalizeRequestedItems(request.data?.items);
  const groupedQuantities = groupRequestedItems(items);
  const orderRef = db.collection('orders').doc();
  let createdOrder: CheckoutOrder | null = null;

  await db.runTransaction(async (transaction: Transaction) => {
    const productEntries = await readProducts(transaction, Array.from(groupedQuantities.keys()));
    const campaignEntries = await readCampaigns(transaction, productEntries);
    const customerRef = getCustomerRef(auth.uid);
    const customerSnapshot = await transaction.get(customerRef);
    const existingCustomer = customerSnapshot.exists
      ? reviveCustomerProfile(customerSnapshot.id, customerSnapshot.data() as Partial<CustomerProfile>)
      : null;
    const orderItems: OrderItem[] = [];

    for (const [productId, quantity] of groupedQuantities.entries()) {
      const productEntry = productEntries.get(productId);
      const firstItem = items.find((item) => item.productId === productId);

      if (!productEntry || !firstItem) {
        throw new HttpsError('not-found', `La pieza "${firstItem?.productId ?? productId}" ya no esta disponible.`);
      }

      const { product, ref } = productEntry;
      const currentStock = typeof product.stock === 'number' ? product.stock : 0;
      const currentStatus = normalizeProductStatus(product.status, currentStock);

      if (!isProductVisible(currentStatus)) {
        throw new HttpsError('failed-precondition', `La pieza "${product.name ?? productId}" ya no esta disponible.`);
      }

      if (currentStock < quantity) {
        throw new HttpsError(
          'failed-precondition',
          `Solo quedan ${currentStock} unidades de "${product.name ?? productId}".`,
        );
      }

      const unitPrice = resolveProductPrice(product, campaignEntries);
      const appliedCampaign = resolveAppliedCampaignPricing(product, campaignEntries);

      for (const item of items.filter((entry) => entry.productId === productId)) {
        orderItems.push({
          productId,
          productName: product.name ?? productId,
          imageUrl: product.imageUrl ?? '',
          category: sanitizeString(product.category) || null,
          categorySlug: sanitizeString(product.categorySlug) || null,
          collection: sanitizeString(product.collection) || null,
          collectionSlug: sanitizeString(product.collectionSlug) || null,
          campaignId: appliedCampaign?.id ?? null,
          campaignName: appliedCampaign?.name ?? null,
          quantity: item.quantity,
          variant: item.variant,
          unitPrice,
          lineTotal: normalizeMoney(unitPrice * item.quantity),
        });
      }

      const nextStock = currentStock - quantity;
      transaction.update(ref, {
        stock: nextStock,
        status: normalizeProductStatus(currentStatus, nextStock),
      });
    }

    const subtotal = normalizeMoney(orderItems.reduce((total, item) => total + item.lineTotal, 0));
    const shipping = calculateShipping(subtotal);
    const now = new Date();

    createdOrder = {
      id: orderRef.id,
      userId: auth.uid,
      customer,
      items: orderItems,
      subtotal,
      shipping,
      total: normalizeMoney(subtotal + shipping),
      channel: 'whatsapp',
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };

    transaction.set(orderRef, createdOrder);
    transaction.set(customerRef, mergeOrderIntoCustomerProfile(existingCustomer, createdOrder));
  });

  if (!createdOrder) {
    throw new HttpsError('internal', 'No se pudo construir el pedido.');
  }

  return serializeOrder(createdOrder);
});

export const rebuildCustomerProfiles = onCall<Record<string, never>, Promise<RebuildCustomerProfilesResult>>(
  async (request: CallableRequest<Record<string, never>>) => {
    assertAdmin(request.auth);

    const [ordersSnapshot, customersSnapshot] = await Promise.all([
      db.collection('orders').get(),
      db.collection('customers').get(),
    ]);
    const customersByUser = new Map<string, CustomerProfile>();

    for (const orderDoc of ordersSnapshot.docs) {
      const order = reviveOrder(orderDoc.id, orderDoc.data() as Partial<CheckoutOrder>);
      const existing = customersByUser.get(order.userId);
      customersByUser.set(order.userId, mergeOrderIntoCustomerProfile(existing ?? null, order));
    }

    const batch = db.batch();

    for (const customerDoc of customersSnapshot.docs) {
      batch.delete(customerDoc.ref);
    }

    for (const customer of customersByUser.values()) {
      batch.set(getCustomerRef(customer.userId), customer);
    }

    await batch.commit();

    return {
      customersSynced: customersByUser.size,
    };
  },
);

export const updateOrderStatus = onCall<UpdateOrderStatusPayload>(
  async (request: CallableRequest<UpdateOrderStatusPayload>) => {
  assertAdmin(request.auth);

  const orderId = normalizeOrderId(request.data?.orderId);
  const nextStatus = normalizeTargetStatus(request.data?.status);
  const orderRef = db.collection('orders').doc(orderId);
  let updatedOrder: CheckoutOrder | null = null;

  await db.runTransaction(async (transaction: Transaction) => {
    const orderSnapshot = await transaction.get(orderRef);

    if (!orderSnapshot.exists) {
      throw new HttpsError('not-found', 'No se encontro el pedido que intentas actualizar.');
    }

    const currentOrder = reviveOrder(orderSnapshot.id, orderSnapshot.data() as Partial<CheckoutOrder>);
    const customerRef = getCustomerRef(currentOrder.userId);
    const customerSnapshot = await transaction.get(customerRef);
    const existingCustomer = customerSnapshot.exists
      ? reviveCustomerProfile(customerSnapshot.id, customerSnapshot.data() as Partial<CustomerProfile>)
      : createCustomerProfileFromOrder(currentOrder);

    if (currentOrder.status === nextStatus) {
      updatedOrder = currentOrder;
      return;
    }

    if (!allowedTransitions[currentOrder.status].includes(nextStatus)) {
      throw new HttpsError(
        'failed-precondition',
        `No se puede pasar de "${currentOrder.status}" a "${nextStatus}".`,
      );
    }

    const groupedQuantities = groupOrderItems(currentOrder.items);

    if (shouldReleaseInventory(currentOrder.status, nextStatus)) {
      const productEntries = await readProducts(transaction, Array.from(groupedQuantities.keys()));

      for (const [productId, quantity] of groupedQuantities.entries()) {
        const productEntry = productEntries.get(productId);

        if (!productEntry) {
          continue;
        }

        const currentStock = typeof productEntry.product.stock === 'number' ? productEntry.product.stock : 0;
        const currentStatus = normalizeProductStatus(productEntry.product.status, currentStock);
        const nextStock = currentStock + quantity;

        transaction.update(productEntry.ref, {
          stock: nextStock,
          status: normalizeProductStatus(currentStatus, nextStock),
        });
      }
    }

    if (shouldReserveInventory(currentOrder.status, nextStatus)) {
      const productEntries = await readProducts(transaction, Array.from(groupedQuantities.keys()));

      for (const [productId, quantity] of groupedQuantities.entries()) {
        const productEntry = productEntries.get(productId);
        const item = currentOrder.items.find((entry) => entry.productId === productId);

        if (!productEntry) {
          throw new HttpsError('not-found', `La pieza "${item?.productName ?? productId}" ya no esta disponible.`);
        }

        const currentStock = typeof productEntry.product.stock === 'number' ? productEntry.product.stock : 0;
        const currentStatus = normalizeProductStatus(productEntry.product.status, currentStock);

        if (!isProductVisible(currentStatus)) {
          throw new HttpsError(
            'failed-precondition',
            `La pieza "${item?.productName ?? productId}" ya no esta disponible.`,
          );
        }

        if (currentStock < quantity) {
          throw new HttpsError(
            'failed-precondition',
            `Solo quedan ${currentStock} unidades de "${item?.productName ?? productId}".`,
          );
        }

        const nextStock = currentStock - quantity;

        transaction.update(productEntry.ref, {
          stock: nextStock,
          status: normalizeProductStatus(currentStatus, nextStock),
        });
      }
    }

    const nextOrder: CheckoutOrder = {
      ...currentOrder,
      status: nextStatus,
      updatedAt: new Date(),
    };

    transaction.update(orderRef, {
      status: nextOrder.status,
      updatedAt: nextOrder.updatedAt,
    });

    transaction.set(customerRef, applyOrderStatusToCustomerProfile(existingCustomer, currentOrder, nextOrder));

    updatedOrder = nextOrder;
  });

  if (!updatedOrder) {
    throw new HttpsError('internal', 'No se pudo actualizar el pedido.');
  }

  return serializeOrder(updatedOrder);
  },
);

function assertAuthenticated(auth: { uid: string } | null | undefined): { uid: string } {
  if (!auth?.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesion para crear pedidos.');
  }

  return auth;
}

function assertFunctionsEmulator(): void {
  if (process.env['FUNCTIONS_EMULATOR'] !== 'true') {
    throw new HttpsError('permission-denied', 'Esta operacion solo esta disponible en el entorno local.');
  }
}

function assertAdmin(auth: { uid: string; token?: { email?: string } } | null | undefined): void {
  const session = assertAuthenticated(auth);
  const email = auth?.token?.email?.toLowerCase();

  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError('permission-denied', `La cuenta ${session.uid} no tiene permisos de administracion.`);
  }
}

function normalizeCustomer(customer: unknown): CustomerContact {
  if (!customer || typeof customer !== 'object') {
    throw new HttpsError('invalid-argument', 'Faltan los datos de contacto del pedido.');
  }

  const record = customer as Record<string, unknown>;
  const deliveryMethod = record['deliveryMethod'] === 'pickup' ? 'pickup' : 'shipping';
  const addressLine1 = sanitizeString(record['addressLine1']);
  const postalCode = sanitizeString(record['postalCode']);
  const city = sanitizeString(record['city']);
  const province = sanitizeString(record['province']);

  const normalized: CustomerContact = {
    name: requireText(record['name'], 'El nombre es obligatorio.'),
    email: requireText(record['email'], 'El email es obligatorio.'),
    phone: requireText(record['phone'], 'El telefono es obligatorio.'),
    deliveryMethod,
    addressLine1: deliveryMethod === 'shipping' ? addressLine1 : null,
    postalCode,
    city,
    province,
    notes: sanitizeString(record['notes']) || null,
  };

  if (deliveryMethod === 'shipping' && !normalized.addressLine1) {
    throw new HttpsError('invalid-argument', 'La direccion es obligatoria para envios.');
  }

  if (!/^\d{5}$/.test(normalized.postalCode)) {
    throw new HttpsError('invalid-argument', 'El codigo postal debe tener 5 digitos.');
  }

  if (!/^[0-9+\s]{9,15}$/.test(normalized.phone)) {
    throw new HttpsError('invalid-argument', 'El telefono no tiene un formato valido.');
  }

  if (!normalized.city || !normalized.province) {
    throw new HttpsError('invalid-argument', 'La ciudad y la provincia son obligatorias.');
  }

  return normalized;
}

function normalizeRequestedItems(items: unknown): OrderRequestItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'El pedido no contiene productos.');
  }

  return items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpsError('invalid-argument', 'Hay lineas de pedido invalidas.');
    }

    const record = item as Record<string, unknown>;
    const productId = requireText(record['productId'], 'Falta un identificador de producto.');
    const variant = requireText(record['variant'], `Falta la variante del producto ${productId}.`);
    const quantity = Number(record['quantity']);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', `La cantidad del producto ${productId} no es valida.`);
    }

    return {
      productId,
      variant,
      quantity,
    };
  });
}

function normalizeOrderId(orderId: unknown): string {
  return requireText(orderId, 'Falta el identificador del pedido.');
}

function getCustomerRef(userId: string): DocumentReference {
  return db.collection('customers').doc(userId);
}

function normalizeTargetStatus(status: unknown): OrderStatus {
  switch (status) {
    case 'new':
    case 'confirmed':
    case 'prepared':
    case 'completed':
    case 'cancelled':
      return status;
    default:
      throw new HttpsError('invalid-argument', 'El nuevo estado del pedido no es valido.');
  }
}

function requireText(value: unknown, message: string): string {
  const text = sanitizeString(value);

  if (!text) {
    throw new HttpsError('invalid-argument', message);
  }

  return text;
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readProducts(
  transaction: Transaction,
  productIds: string[],
): Promise<Map<string, { ref: DocumentReference; product: StoredProduct }>> {
  const entries = new Map<string, { ref: DocumentReference; product: StoredProduct }>();

  for (const productId of productIds) {
    const ref = db.collection('products').doc(productId);
    const snapshot = await transaction.get(ref);

    if (snapshot.exists) {
      entries.set(productId, {
        ref,
        product: snapshot.data() as StoredProduct,
      });
    }
  }

  return entries;
}

async function readCampaigns(
  transaction: Transaction,
  productEntries: Map<string, { ref: DocumentReference; product: StoredProduct }>,
): Promise<Map<string, CampaignPricing>> {
  const campaigns = new Map<string, CampaignPricing>();
  const campaignIds = Array.from(
    new Set(
      Array.from(productEntries.values())
        .flatMap(({ product }) => normalizeProductCampaignIds(product))
        .filter((campaignId): campaignId is string => typeof campaignId === 'string' && !!campaignId),
    ),
  );

  for (const campaignId of campaignIds) {
    const ref = db.collection('campaigns').doc(campaignId);
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists) {
      continue;
    }

    const data = snapshot.data() as StoredCampaign;

    campaigns.set(campaignId, {
      name: sanitizeString(data.name),
      badge: sanitizeString(data.badge),
      discountType: data.discountType === 'fixed' ? 'fixed' : 'percentage',
      discountValue: typeof data.discountValue === 'number' ? data.discountValue : 0,
      active: data.active !== false,
      startsAt: toDate(data.startsAt),
      endsAt: toDate(data.endsAt),
    });
  }

  return campaigns;
}

function groupRequestedItems(items: OrderRequestItem[]): Map<string, number> {
  return items.reduce((accumulator, item) => {
    accumulator.set(item.productId, (accumulator.get(item.productId) ?? 0) + item.quantity);
    return accumulator;
  }, new Map<string, number>());
}

function groupOrderItems(items: OrderItem[]): Map<string, number> {
  return items.reduce((accumulator, item) => {
    accumulator.set(item.productId, (accumulator.get(item.productId) ?? 0) + item.quantity);
    return accumulator;
  }, new Map<string, number>());
}

function createCustomerProfileFromOrder(order: CheckoutOrder): CustomerProfile {
  const countsForStats = order.status !== 'cancelled';

  return {
    id: order.userId,
    userId: order.userId,
    name: order.customer.name,
    email: order.customer.email,
    phone: order.customer.phone,
    deliveryMethodPreference: order.customer.deliveryMethod,
    addressLine1: order.customer.addressLine1,
    postalCode: order.customer.postalCode,
    city: order.customer.city,
    province: order.customer.province,
    notes: order.customer.notes,
    totalOrders: countsForStats ? 1 : 0,
    totalSpent: countsForStats ? normalizeMoney(order.total) : 0,
    lastOrderId: order.id,
    lastOrderStatus: order.status,
    lastOrderAt: order.createdAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function mergeOrderIntoCustomerProfile(existingCustomer: CustomerProfile | null, order: CheckoutOrder): CustomerProfile {
  if (!existingCustomer) {
    return createCustomerProfileFromOrder(order);
  }

  const countsForStats = order.status !== 'cancelled';
  const isLatestOrder =
    !existingCustomer.lastOrderAt || order.createdAt.getTime() >= existingCustomer.lastOrderAt.getTime();

  return {
    ...existingCustomer,
    name: order.customer.name,
    email: order.customer.email,
    phone: order.customer.phone,
    deliveryMethodPreference: order.customer.deliveryMethod,
    addressLine1: order.customer.addressLine1,
    postalCode: order.customer.postalCode,
    city: order.customer.city,
    province: order.customer.province,
    notes: order.customer.notes,
    totalOrders: existingCustomer.totalOrders + (countsForStats ? 1 : 0),
    totalSpent: normalizeMoney(existingCustomer.totalSpent + (countsForStats ? order.total : 0)),
    lastOrderId: isLatestOrder ? order.id : existingCustomer.lastOrderId,
    lastOrderStatus: isLatestOrder ? order.status : existingCustomer.lastOrderStatus,
    lastOrderAt: isLatestOrder ? order.createdAt : existingCustomer.lastOrderAt,
    createdAt:
      order.createdAt.getTime() < existingCustomer.createdAt.getTime()
        ? order.createdAt
        : existingCustomer.createdAt,
    updatedAt:
      order.updatedAt.getTime() > existingCustomer.updatedAt.getTime()
        ? order.updatedAt
        : existingCustomer.updatedAt,
  };
}

function applyOrderStatusToCustomerProfile(
  existingCustomer: CustomerProfile,
  currentOrder: CheckoutOrder,
  nextOrder: CheckoutOrder,
): CustomerProfile {
  const shouldSubtractOrder = currentOrder.status !== 'cancelled' && nextOrder.status === 'cancelled';
  const shouldAddOrder = currentOrder.status === 'cancelled' && nextOrder.status !== 'cancelled';
  const isTrackedAsLatestOrder = existingCustomer.lastOrderId === currentOrder.id;

  return {
    ...existingCustomer,
    totalOrders: Math.max(
      0,
      existingCustomer.totalOrders + (shouldAddOrder ? 1 : 0) - (shouldSubtractOrder ? 1 : 0),
    ),
    totalSpent: Math.max(
      0,
      normalizeMoney(
        existingCustomer.totalSpent +
          (shouldAddOrder ? currentOrder.total : 0) -
          (shouldSubtractOrder ? currentOrder.total : 0),
      ),
    ),
    lastOrderStatus: isTrackedAsLatestOrder ? nextOrder.status : existingCustomer.lastOrderStatus,
    lastOrderAt: isTrackedAsLatestOrder ? nextOrder.createdAt : existingCustomer.lastOrderAt,
    updatedAt: nextOrder.updatedAt,
  };
}

function normalizeProductStatus(status: ProductStatus | undefined, stock: number): ProductStatus {
  if (status === 'hidden') {
    return 'hidden';
  }

  if (stock <= 0) {
    return 'sold_out';
  }

  return 'active';
}

function isProductVisible(status: ProductStatus): boolean {
  return status !== 'hidden';
}

function resolveProductPrice(product: StoredProduct, campaigns: Map<string, CampaignPricing>): number {
  const originalPrice = normalizeMoney(typeof product.originalPrice === 'number' ? product.originalPrice : 0);
  const pricingMode = normalizePricingMode(product);

  if (
    pricingMode === 'individual_offer' &&
    typeof product.offerPrice === 'number' &&
    product.offerPrice > 0 &&
    product.offerPrice < originalPrice
  ) {
    return normalizeMoney(product.offerPrice);
  }

  if (pricingMode === 'campaign') {
    const appliedCampaign = resolveAppliedCampaignPricing(product, campaigns);

    if (appliedCampaign) {
      return appliedCampaign.effectivePrice;
    }
  }

  return originalPrice;
}

function resolveAppliedCampaignPricing(
  product: StoredProduct,
  campaigns: Map<string, CampaignPricing>,
): AppliedCampaignPricing | null {
  const originalPrice = normalizeMoney(typeof product.originalPrice === 'number' ? product.originalPrice : 0);

  if (normalizePricingMode(product) !== 'campaign') {
    return null;
  }

  const appliedCampaign = normalizeProductCampaignIds(product)
    .map((campaignId) => {
      const campaign = campaigns.get(campaignId);

      if (!campaign || !isCampaignActive(campaign)) {
        return null;
      }

      const effectivePrice = campaign.discountType === 'fixed'
        ? normalizeMoney(Math.max(0, originalPrice - campaign.discountValue))
        : normalizeMoney(originalPrice * (1 - campaign.discountValue / 100));

      if (effectivePrice >= originalPrice) {
        return null;
      }

      return {
        id: campaignId,
        name: campaign.name || null,
        effectivePrice,
      };
    })
    .filter((entry): entry is AppliedCampaignPricing => !!entry)
    .sort((left, right) => left.effectivePrice - right.effectivePrice)[0];

  return appliedCampaign ?? null;
}

function normalizePricingMode(product: StoredProduct): ProductPricingMode {
  if (product.pricingMode) {
    return product.pricingMode;
  }

  if (normalizeProductCampaignIds(product).length > 0) {
    return 'campaign';
  }

  if (typeof product.offerPrice === 'number' && product.offerPrice > 0) {
    return 'individual_offer';
  }

  return 'regular';
}

function normalizeProductCampaignIds(product: Partial<StoredProduct>): string[] {
  const explicitCampaignIds = Array.isArray(product.campaignIds)
    ? product.campaignIds.filter((campaignId): campaignId is string => typeof campaignId === 'string')
    : [];
  const legacyCampaignId = typeof product.campaignId === 'string' ? product.campaignId.trim() : '';

  return Array.from(new Set([...explicitCampaignIds, legacyCampaignId].map((campaignId) => campaignId.trim()).filter(Boolean)));
}

function isCampaignActive(campaign: CampaignPricing, now = new Date()): boolean {
  if (!campaign.active) {
    return false;
  }

  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (campaign.endsAt && campaign.endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}

function calculateShipping(subtotal: number): number {
  return subtotal > 0 && subtotal < FREE_SHIPPING_THRESHOLD ? SHIPPING_PRICE : 0;
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function shouldReleaseInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  return currentStatus !== 'cancelled' && nextStatus === 'cancelled';
}

function shouldReserveInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  return currentStatus === 'cancelled' && nextStatus !== 'cancelled';
}

function reviveOrder(id: string, data: Partial<CheckoutOrder>): CheckoutOrder {
  return {
    id,
    userId: sanitizeString(data.userId),
    customer: normalizeCustomer(data.customer),
    items: Array.isArray(data.items) ? data.items : [],
    subtotal: typeof data.subtotal === 'number' ? data.subtotal : 0,
    shipping: typeof data.shipping === 'number' ? data.shipping : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    channel: 'whatsapp',
    status: normalizeStoredOrderStatus(data.status),
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? toDate(data.createdAt) ?? new Date(),
  };
}

function normalizeStoredOrderStatus(status: unknown): OrderStatus {
  switch (status) {
    case 'confirmed':
    case 'prepared':
    case 'completed':
    case 'cancelled':
    case 'new':
      return status;
    case 'sent':
      return 'completed';
    case 'draft':
    default:
      return 'new';
  }
}

function reviveCustomerProfile(id: string, data: Partial<CustomerProfile>): CustomerProfile {
  return {
    id,
    userId: sanitizeString(data.userId) || id,
    name: sanitizeString(data.name),
    email: sanitizeString(data.email),
    phone: sanitizeString(data.phone) || null,
    deliveryMethodPreference: data.deliveryMethodPreference === 'pickup'
      ? 'pickup'
      : data.deliveryMethodPreference === 'shipping'
        ? 'shipping'
        : null,
    addressLine1: sanitizeString(data.addressLine1) || null,
    postalCode: sanitizeString(data.postalCode),
    city: sanitizeString(data.city),
    province: sanitizeString(data.province),
    notes: sanitizeString(data.notes) || null,
    totalOrders: typeof data.totalOrders === 'number' ? data.totalOrders : 0,
    totalSpent: typeof data.totalSpent === 'number' ? normalizeMoney(data.totalSpent) : 0,
    lastOrderId: sanitizeString(data.lastOrderId) || null,
    lastOrderStatus: data.lastOrderStatus ? normalizeStoredOrderStatus(data.lastOrderStatus) : null,
    lastOrderAt: toDate(data.lastOrderAt) ?? null,
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? toDate(data.createdAt) ?? new Date(),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return null;
}

function serializeOrder(order: CheckoutOrder): SerializedCheckoutOrder {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

const DEMO_CAMPAIGNS = [
  {
    id: 'cmp-verano-2026',
    name: 'Campana Verano 2026',
    badge: 'Verano',
    description: 'Seleccion de temporada con descuento suave para piezas ligeras y de viaje.',
    discountType: 'percentage' as const,
    discountValue: 15,
    active: true,
    startsAt: new Date('2026-06-01'),
    endsAt: new Date('2026-08-31'),
  },
  {
    id: 'cmp-vuelta-taller-2026',
    name: 'Vuelta al Taller',
    badge: 'Septiembre',
    description: 'Campana preparada para la siguiente temporada.',
    discountType: 'fixed' as const,
    discountValue: 6,
    active: false,
    startsAt: new Date('2026-09-01'),
    endsAt: new Date('2026-09-30'),
  },
];

const DEMO_PRODUCTS = [
  {
    id: 'prd-bolso-alba',
    name: 'Bolso Alba',
    slug: 'bolso-alba',
    description: 'Bolso de mano en tejido jacquard floral con asa corta y cierre interior.',
    story: 'Una pieza tranquila para planes de tarde, hecha en series pequenas con tejidos seleccionados.',
    originalPrice: 58,
    offerPrice: null,
    imageUrl: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Bolsos',
    categorySlug: 'bolsos',
    collection: 'Invitada',
    collectionSlug: 'invitada',
    stock: 4,
    sizes: ['Unica'],
    colors: ['Arena', 'Flor cereza'],
    pricingMode: 'regular' as const,
    campaignIds: [],
    featured: true,
    status: 'active' as const,
    createdAt: new Date('2026-06-01'),
  },
  {
    id: 'prd-neceser-lia',
    name: 'Neceser Lia',
    slug: 'neceser-lia',
    description: 'Neceser acolchado con forro lavable, pensado para bolso diario o viaje.',
    story: 'Compacto por fuera, generoso por dentro. El tipo de pieza que termina yendo a todas partes.',
    originalPrice: 32,
    offerPrice: null,
    imageUrl: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1605733160314-4fc7dac4bb16?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Neceseres',
    categorySlug: 'neceseres',
    collection: 'Verano',
    collectionSlug: 'verano',
    stock: 8,
    sizes: ['S', 'M'],
    colors: ['Verde salvia', 'Crudo'],
    pricingMode: 'campaign' as const,
    campaignIds: ['cmp-verano-2026'],
    featured: true,
    status: 'active' as const,
    createdAt: new Date('2026-06-03'),
  },
  {
    id: 'prd-tote-maia',
    name: 'Tote Maia',
    slug: 'tote-maia',
    description: 'Bolso tote amplio con asas resistentes, bolsillo interior y patron reversible.',
    story: 'Creado para acompanar compras, trabajo y escapadas cortas sin perder el punto artesanal.',
    originalPrice: 64,
    offerPrice: null,
    imageUrl: 'https://images.unsplash.com/photo-1605733160314-4fc7dac4bb16?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1605733160314-4fc7dac4bb16?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Bolsos',
    categorySlug: 'bolsos',
    collection: 'Diario',
    collectionSlug: 'diario',
    stock: 3,
    sizes: ['Unica'],
    colors: ['Azul tinta', 'Rayas'],
    pricingMode: 'regular' as const,
    campaignIds: [],
    featured: true,
    status: 'active' as const,
    createdAt: new Date('2026-06-06'),
  },
  {
    id: 'prd-funda-nora',
    name: 'Funda Nora',
    slug: 'funda-nora',
    description: 'Funda acolchada para tablet o libro electronico con cierre suave.',
    story: 'Proteccion bonita para objetos cotidianos, con costuras reforzadas y tacto mullido.',
    originalPrice: 36,
    offerPrice: null,
    imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Fundas',
    categorySlug: 'fundas',
    collection: 'Organizacion',
    collectionSlug: 'organizacion',
    stock: 6,
    sizes: ['Tablet', 'E-reader'],
    colors: ['Malva', 'Natural'],
    pricingMode: 'regular' as const,
    campaignIds: [],
    featured: false,
    status: 'active' as const,
    createdAt: new Date('2026-06-08'),
  },
  {
    id: 'prd-cuelgamovil-iris',
    name: 'Cuelgamovil Iris',
    slug: 'cuelgamovil-iris',
    description: 'Correa de movil con tejido estampado, mosquetones metalicos y largo ajustable.',
    story: 'Un accesorio ligero para llevar el movil a mano sin renunciar a un acabado especial.',
    originalPrice: 24,
    offerPrice: 19,
    imageUrl: 'https://images.unsplash.com/photo-1600721391776-b5cd0e0048f9?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1600721391776-b5cd0e0048f9?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Accesorios',
    categorySlug: 'accesorios',
    collection: 'Verano',
    collectionSlug: 'verano',
    stock: 12,
    sizes: ['Ajustable'],
    colors: ['Mostaza', 'Negro'],
    pricingMode: 'individual_offer' as const,
    campaignIds: [],
    featured: false,
    status: 'active' as const,
    createdAt: new Date('2026-06-10'),
  },
  {
    id: 'prd-bolso-cala',
    name: 'Bolso Cala',
    slug: 'bolso-cala',
    description: 'Bolso pequeno cruzado con solapa, ideal para eventos y salidas ligeras.',
    story: 'Una silueta compacta con presencia, terminada a mano para que cada pieza sea ligeramente unica.',
    originalPrice: 49,
    offerPrice: null,
    imageUrl: 'https://images.unsplash.com/photo-1575032617751-6ddec2089882?auto=format&fit=crop&w=900&q=80',
    gallery: [
      'https://images.unsplash.com/photo-1575032617751-6ddec2089882?auto=format&fit=crop&w=900&q=80',
      'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80',
    ],
    category: 'Bolsos',
    categorySlug: 'bolsos',
    collection: 'Invitada',
    collectionSlug: 'invitada',
    stock: 5,
    sizes: ['Unica'],
    colors: ['Negro', 'Terracota'],
    pricingMode: 'regular' as const,
    campaignIds: [],
    featured: false,
    status: 'active' as const,
    createdAt: new Date('2026-06-12'),
  },
];
