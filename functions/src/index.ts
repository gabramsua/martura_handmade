import { initializeApp } from 'firebase-admin/app';
import { DocumentReference, Timestamp, Transaction, getFirestore } from 'firebase-admin/firestore';
import { CallableRequest, HttpsError, onCall } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

const db = getFirestore();
const DEFAULT_SHIPPING_PRICE = 4.95;
const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  'gabramsua@gmail.com'
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ORDER_CODE_LENGTH = 8;

type DeliveryMethod = 'shipping';
type ProductStatus = 'active' | 'sold_out' | 'hidden';
type ProductPricingMode = 'regular' | 'individual_offer' | 'campaign';
type OrderStatus = 'in_factory' | 'accepted' | 'shipped' | 'delivered' | 'cancelled';
type CampaignDiscountType = 'percentage' | 'fixed';
type DiscountCodeType = 'percentage' | 'fixed';
type DiscountCodeScope = 'all' | 'products';

interface CustomerContact {
  name: string;
  email: string;
  phone: string;
  dni: string;
  deliveryMethod: DeliveryMethod;
  addressLine1: string;
  postalCode: string;
  city: string;
  province: string;
  comments: string | null;
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
  subcategory?: string | null;
  subcategorySlug?: string | null;
  collection?: string | null;
  collectionSlug?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  quantity: number;
  variant: string;
  unitPrice: number;
  lineTotal: number;
}

interface AppliedDiscountCode {
  code: string;
  description: string;
  amount: number;
}

interface CheckoutOrder {
  id: string;
  customer: CustomerContact;
  items: OrderItem[];
  subtotal: number;
  discount: AppliedDiscountCode | null;
  shipping: number;
  total: number;
  paymentMethod: 'bizum';
  status: OrderStatus;
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
  discountCode: string | null;
}

interface UpdateOrderStatusPayload {
  orderId: string;
  status: OrderStatus;
}

interface StoredProduct {
  name?: string;
  imageUrl?: string;
  category?: string;
  categorySlug?: string;
  subcategory?: string | null;
  subcategorySlug?: string | null;
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
  id: string;
  name: string;
  badge: string;
  discountType: CampaignDiscountType;
  discountValue: number;
  active: boolean;
  startsAt: Date | Timestamp | null;
  endsAt: Date | Timestamp | null;
}

interface StoredDiscountCode {
  id: string;
  code: string;
  description: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  scope: DiscountCodeScope;
  productIds: string[];
  startsAt: Date | Timestamp | null;
  endsAt: Date | Timestamp | null;
}

interface StoredShopSettings {
  shippingPrice?: number;
}

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  in_factory: ['accepted', 'cancelled'],
  accepted: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: ['in_factory'],
};

export const createOrder = onCall<CreateOrderPayload>(async (request: CallableRequest<CreateOrderPayload>) => {
  const customer = normalizeCustomer(request.data?.customer);
  const items = normalizeRequestedItems(request.data?.items);
  const discountCode = sanitizeString(request.data?.discountCode).toUpperCase() || null;
  const groupedQuantities = groupRequestedItems(items);
  const orderRef = db.collection('orders').doc(generateOrderCode());
  let createdOrder: CheckoutOrder | null = null;

  await db.runTransaction(async (transaction: Transaction) => {
    const productEntries = await readProducts(transaction, Array.from(groupedQuantities.keys()));
    const campaignEntries = await readCampaigns(transaction, productEntries);
    const settings = await readSettings(transaction);
    const orderItems: OrderItem[] = [];

    for (const item of items) {
      const productEntry = productEntries.get(item.productId);

      if (!productEntry) {
        throw new HttpsError('not-found', `La pieza "${item.productId}" ya no está disponible.`);
      }

      const { product } = productEntry;
      const currentStock = typeof product.stock === 'number' ? product.stock : 0;
      const currentStatus = normalizeProductStatus(product.status, currentStock);
      const requiredQuantity = groupedQuantities.get(item.productId) ?? item.quantity;

      if (!isProductVisible(currentStatus)) {
        throw new HttpsError('failed-precondition', `La pieza "${product.name ?? item.productId}" ya no está disponible.`);
      }

      if (currentStock < requiredQuantity) {
        throw new HttpsError(
          'failed-precondition',
          `Solo quedan ${currentStock} unidades de "${product.name ?? item.productId}".`,
        );
      }

      const pricing = resolveProductPrice(product, campaignEntries);
      orderItems.push({
        productId: item.productId,
        productName: product.name ?? item.productId,
        imageUrl: product.imageUrl ?? '',
        category: sanitizeString(product.category) || null,
        categorySlug: sanitizeString(product.categorySlug) || null,
        subcategory: sanitizeString(product.subcategory) || null,
        subcategorySlug: sanitizeString(product.subcategorySlug) || null,
        collection: sanitizeString(product.collection) || null,
        collectionSlug: sanitizeString(product.collectionSlug) || null,
        campaignId: pricing.campaignId,
        campaignName: pricing.campaignName,
        quantity: item.quantity,
        variant: item.variant,
        unitPrice: pricing.effectivePrice,
        lineTotal: normalizeMoney(pricing.effectivePrice * item.quantity),
      });
    }

    const subtotal = normalizeMoney(orderItems.reduce((total, item) => total + item.lineTotal, 0));
    const discount = discountCode
      ? await resolveDiscountCode(transaction, discountCode, orderItems)
      : null;
    const shipping = subtotal > 0 ? settings.shippingPrice : 0;
    const now = new Date();

    for (const [productId, quantity] of groupedQuantities.entries()) {
      const productEntry = productEntries.get(productId);

      if (!productEntry) {
        continue;
      }

      const currentStock = typeof productEntry.product.stock === 'number' ? productEntry.product.stock : 0;
      const nextStock = currentStock - quantity;

      transaction.update(productEntry.ref, {
        stock: nextStock,
        status: normalizeProductStatus(productEntry.product.status, nextStock),
      });
    }

    createdOrder = {
      id: orderRef.id,
      customer,
      items: orderItems,
      subtotal,
      discount,
      shipping: normalizeMoney(shipping),
      total: normalizeMoney(subtotal - (discount?.amount ?? 0) + shipping),
      paymentMethod: 'bizum',
      status: 'in_factory',
      createdAt: now,
      updatedAt: now,
    };

    transaction.set(orderRef, createdOrder);
  });

  if (!createdOrder) {
    throw new HttpsError('internal', 'No se pudo construir el pedido.');
  }

  return serializeOrder(createdOrder);
});

export const updateOrderStatus = onCall<UpdateOrderStatusPayload>(
  async (request: CallableRequest<UpdateOrderStatusPayload>) => {
    assertAdmin(request.auth);

    const orderId = requireText(request.data?.orderId, 'Falta el identificador del pedido.');
    const nextStatus = normalizeTargetStatus(request.data?.status);
    const orderRef = db.collection('orders').doc(orderId);
    let updatedOrder: CheckoutOrder | null = null;

    await db.runTransaction(async (transaction: Transaction) => {
      const orderSnapshot = await transaction.get(orderRef);

      if (!orderSnapshot.exists) {
        throw new HttpsError('not-found', 'No se encontró el pedido que intentas actualizar.');
      }

      const currentOrder = reviveOrder(orderSnapshot.id, orderSnapshot.data() as Partial<CheckoutOrder>);

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
        await applyInventoryAdjustment(transaction, groupedQuantities, 'release');
      }

      if (shouldReserveInventory(currentOrder.status, nextStatus)) {
        await applyInventoryAdjustment(transaction, groupedQuantities, 'reserve');
      }

      updatedOrder = {
        ...currentOrder,
        status: nextStatus,
        updatedAt: new Date(),
      };

      transaction.update(orderRef, {
        status: updatedOrder.status,
        updatedAt: updatedOrder.updatedAt,
      });
    });

    if (!updatedOrder) {
      throw new HttpsError('internal', 'No se pudo actualizar el pedido.');
    }

    return serializeOrder(updatedOrder);
  },
);

function assertAdmin(auth: { uid: string; token?: { email?: string } } | null | undefined): void {
  const email = auth?.token?.email?.toLowerCase();

  if (!auth?.uid || !email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError('permission-denied', 'Tu cuenta no tiene permisos de administración.');
  }
}

function normalizeCustomer(customer: unknown): CustomerContact {
  if (!customer || typeof customer !== 'object') {
    throw new HttpsError('invalid-argument', 'Faltan los datos de contacto del pedido.');
  }

  const record = customer as Record<string, unknown>;
  const normalized: CustomerContact = {
    name: requireText(record['name'], 'El nombre es obligatorio.'),
    email: requireText(record['email'], 'El email es obligatorio.'),
    phone: requireText(record['phone'], 'El teléfono es obligatorio.'),
    dni: requireText(record['dni'], 'El DNI es obligatorio.'),
    deliveryMethod: 'shipping',
    addressLine1: requireText(record['addressLine1'], 'La dirección es obligatoria.'),
    postalCode: requireText(record['postalCode'], 'El código postal es obligatorio.'),
    city: requireText(record['city'], 'La ciudad es obligatoria.'),
    province: requireText(record['province'], 'La provincia es obligatoria.'),
    comments: sanitizeString(record['comments']) || null,
  };

  if (!/^\d{5}$/.test(normalized.postalCode)) {
    throw new HttpsError('invalid-argument', 'El código postal debe tener 5 dígitos.');
  }

  if (!/^[0-9+\s]{9,15}$/.test(normalized.phone)) {
    throw new HttpsError('invalid-argument', 'El teléfono no tiene un formato válido.');
  }

  return normalized;
}

function normalizeRequestedItems(items: unknown): OrderRequestItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'El pedido no contiene productos.');
  }

  return items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new HttpsError('invalid-argument', 'Hay líneas de pedido inválidas.');
    }

    const record = item as Record<string, unknown>;
    const productId = requireText(record['productId'], 'Falta un identificador de producto.');
    const variant = requireText(record['variant'], `Falta la variante del producto ${productId}.`);
    const quantity = Number(record['quantity']);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', `La cantidad del producto ${productId} no es válida.`);
    }

    return { productId, quantity, variant };
  });
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

function generateOrderCode(length = ORDER_CODE_LENGTH): string {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    const characterIndex = Math.floor(Math.random() * ORDER_CODE_ALPHABET.length);
    code += ORDER_CODE_ALPHABET[characterIndex];
  }

  return code;
}

function normalizeTargetStatus(status: unknown): OrderStatus {
  switch (status) {
    case 'in_factory':
    case 'accepted':
    case 'shipped':
    case 'delivered':
    case 'cancelled':
      return status;
    default:
      throw new HttpsError('invalid-argument', 'El nuevo estado del pedido no es válido.');
  }
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

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeNullableDate(value: Date | Timestamp | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  return value.toDate();
}

function normalizeProductCampaignIds(product: StoredProduct): string[] {
  const explicitCampaignIds = Array.isArray(product.campaignIds)
    ? product.campaignIds.filter((campaignId): campaignId is string => typeof campaignId === 'string')
    : [];
  const legacyCampaignId = typeof product.campaignId === 'string' ? product.campaignId.trim() : '';

  return Array.from(new Set([...explicitCampaignIds, legacyCampaignId].map((campaignId) => campaignId.trim()).filter(Boolean)));
}

function groupRequestedItems(items: OrderRequestItem[]): Map<string, number> {
  return items.reduce((quantities, item) => {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    return quantities;
  }, new Map<string, number>());
}

function groupOrderItems(items: OrderItem[]): Map<string, number> {
  return items.reduce((quantities, item) => {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    return quantities;
  }, new Map<string, number>());
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
): Promise<Map<string, StoredCampaign>> {
  const campaigns = new Map<string, StoredCampaign>();
  const campaignIds = Array.from(
    new Set(
      Array.from(productEntries.values())
        .flatMap(({ product }) => normalizeProductCampaignIds(product))
        .filter(Boolean),
    ),
  );

  for (const campaignId of campaignIds) {
    const ref = db.collection('campaigns').doc(campaignId);
    const snapshot = await transaction.get(ref);

    if (snapshot.exists) {
      campaigns.set(campaignId, {
        id: snapshot.id,
        ...(snapshot.data() as Omit<StoredCampaign, 'id'>),
      });
    }
  }

  return campaigns;
}

async function readSettings(transaction: Transaction): Promise<{ shippingPrice: number }> {
  const settingsRef = db.collection('shopSettings').doc('default');
  const snapshot = await transaction.get(settingsRef);

  if (!snapshot.exists) {
    return { shippingPrice: DEFAULT_SHIPPING_PRICE };
  }

  const data = snapshot.data() as StoredShopSettings;

  return {
    shippingPrice:
      typeof data.shippingPrice === 'number' && Number.isFinite(data.shippingPrice)
        ? Math.max(0, data.shippingPrice)
        : DEFAULT_SHIPPING_PRICE,
  };
}

function resolveProductPrice(
  product: StoredProduct,
  campaigns: Map<string, StoredCampaign>,
): {
  effectivePrice: number;
  campaignId: string | null;
  campaignName: string | null;
} {
  const basePrice = normalizeMoney(typeof product.originalPrice === 'number' ? product.originalPrice : 0);

  if (
    product.pricingMode === 'individual_offer' &&
    typeof product.offerPrice === 'number' &&
    product.offerPrice > 0 &&
    product.offerPrice < basePrice
  ) {
    return {
      effectivePrice: normalizeMoney(product.offerPrice),
      campaignId: null,
      campaignName: null,
    };
  }

  if (product.pricingMode === 'campaign') {
    const selectedCampaign = normalizeProductCampaignIds(product)
      .map((campaignId) => campaigns.get(campaignId) ?? null)
      .filter((campaign): campaign is StoredCampaign => !!campaign)
      .filter((campaign) => isCampaignActive(campaign))
      .map((campaign) => ({
        campaign,
        price: calculateCampaignPrice(basePrice, campaign),
      }))
      .filter((entry) => entry.price < basePrice)
      .sort((left, right) => left.price - right.price)[0];

    if (selectedCampaign) {
      return {
        effectivePrice: selectedCampaign.price,
        campaignId: selectedCampaign.campaign.id,
        campaignName: selectedCampaign.campaign.name,
      };
    }
  }

  return {
    effectivePrice: basePrice,
    campaignId: null,
    campaignName: null,
  };
}

function isCampaignActive(campaign: StoredCampaign, now = new Date()): boolean {
  if (!campaign.active) {
    return false;
  }

  const startsAt = normalizeNullableDate(campaign.startsAt);
  const endsAt = normalizeNullableDate(campaign.endsAt);

  if (startsAt && startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (endsAt && endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}

function calculateCampaignPrice(basePrice: number, campaign: StoredCampaign): number {
  if (campaign.discountType === 'fixed') {
    return normalizeMoney(Math.max(0, basePrice - campaign.discountValue));
  }

  return normalizeMoney(basePrice * (1 - campaign.discountValue / 100));
}

async function resolveDiscountCode(
  transaction: Transaction,
  code: string,
  items: OrderItem[],
): Promise<AppliedDiscountCode> {
  throwIfInvalidCodeInput(code);
  const codeRef = db.collection('discountCodes').doc(`discount-${code.toLowerCase()}`);
  const snapshot = await transaction.get(codeRef);

  if (!snapshot.exists) {
    throw new HttpsError('invalid-argument', 'Ese código no existe o ya no está disponible.');
  }

  const discountCode = {
    id: snapshot.id,
    ...(snapshot.data() as Omit<StoredDiscountCode, 'id'>),
  } as StoredDiscountCode;

  if (!isDiscountCodeActive(discountCode)) {
    throw new HttpsError('invalid-argument', 'Ese código ya no está activo.');
  }

  const eligibleItems = discountCode.scope === 'all'
    ? items
    : items.filter((item) => discountCode.productIds.includes(item.productId));
  const eligibleSubtotal = eligibleItems.reduce((total, item) => total + item.lineTotal, 0);

  if (eligibleSubtotal <= 0) {
    throw new HttpsError('invalid-argument', 'Ese código no aplica a los productos de este pedido.');
  }

  const rawAmount = discountCode.type === 'fixed'
    ? discountCode.value
    : eligibleSubtotal * (discountCode.value / 100);

  return {
    code: discountCode.code,
    description: discountCode.description,
    amount: normalizeMoney(Math.min(eligibleSubtotal, rawAmount)),
  };
}

function throwIfInvalidCodeInput(code: string): void {
  if (!code.trim()) {
    throw new HttpsError('invalid-argument', 'El código de descuento está vacío.');
  }
}

function isDiscountCodeActive(discountCode: StoredDiscountCode, now = new Date()): boolean {
  if (!discountCode.active) {
    return false;
  }

  const startsAt = normalizeNullableDate(discountCode.startsAt);
  const endsAt = normalizeNullableDate(discountCode.endsAt);

  if (startsAt && startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (endsAt && endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}

function reviveOrder(orderId: string, data: Partial<CheckoutOrder>): CheckoutOrder {
  const createdAt = normalizeUnknownDate(data.createdAt);

  return {
    id: orderId,
    customer: {
      name: sanitizeString(data.customer?.name),
      email: sanitizeString(data.customer?.email),
      phone: sanitizeString(data.customer?.phone),
      dni: sanitizeString(data.customer?.dni),
      deliveryMethod: 'shipping',
      addressLine1: sanitizeString(data.customer?.addressLine1),
      postalCode: sanitizeString(data.customer?.postalCode),
      city: sanitizeString(data.customer?.city),
      province: sanitizeString(data.customer?.province),
      comments: data.customer?.comments ?? null,
    },
    items: Array.isArray(data.items) ? data.items : [],
    subtotal: typeof data.subtotal === 'number' ? data.subtotal : 0,
    discount: data.discount ?? null,
    shipping: typeof data.shipping === 'number' ? data.shipping : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    paymentMethod: 'bizum',
    status: normalizeTargetStatus(data.status),
    createdAt,
    updatedAt: normalizeUnknownDate(data.updatedAt) ?? createdAt,
  };
}

function normalizeUnknownDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return new Date();
}

async function applyInventoryAdjustment(
  transaction: Transaction,
  groupedQuantities: Map<string, number>,
  operation: 'reserve' | 'release',
): Promise<void> {
  const productEntries = new Map<string, { ref: DocumentReference; product: StoredProduct | null }>();

  for (const [productId] of groupedQuantities.entries()) {
    const ref = db.collection('products').doc(productId);
    const snapshot = await transaction.get(ref);

    productEntries.set(productId, {
      ref,
      product: snapshot.exists ? (snapshot.data() as StoredProduct) : null,
    });
  }

  for (const [productId, quantity] of groupedQuantities.entries()) {
    const productEntry = productEntries.get(productId);
    const product = productEntry?.product ?? null;

    if (!productEntry || !product) {
      if (operation === 'reserve') {
        throw new HttpsError('not-found', `La pieza "${productId}" ya no está disponible.`);
      }
      continue;
    }

    const currentStock = typeof product.stock === 'number' ? product.stock : 0;
    const nextStock = operation === 'reserve' ? currentStock - quantity : currentStock + quantity;

    if (operation === 'reserve' && nextStock < 0) {
      throw new HttpsError('failed-precondition', `No queda stock suficiente de la pieza "${product.name ?? productId}".`);
    }

    transaction.update(productEntry.ref, {
      stock: nextStock,
      status: normalizeProductStatus(product.status, nextStock),
    });
  }
}

function shouldReleaseInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  return currentStatus !== 'cancelled' && nextStatus === 'cancelled';
}

function shouldReserveInventory(currentStatus: OrderStatus, nextStatus: OrderStatus): boolean {
  return currentStatus === 'cancelled' && nextStatus !== 'cancelled';
}

function serializeOrder(order: CheckoutOrder): SerializedCheckoutOrder {
  return {
    ...order,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
