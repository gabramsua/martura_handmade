import { CartItem } from './cart.model';
import { Campaign } from './campaign.model';
import { resolveProductPricing } from '../utils/product-pricing';

export type DeliveryMethod = 'shipping';
export type PaymentMethod = 'bizum';
export type OrderStatus = 'in_factory' | 'accepted' | 'shipped' | 'delivered' | 'cancelled';

export interface CustomerContact {
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

export interface OrderItem {
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

export interface OrderRequestItem {
  productId: string;
  quantity: number;
  variant: string;
}

export interface AppliedDiscountCode {
  code: string;
  description: string;
  amount: number;
}

export interface CheckoutOrder {
  id: string;
  customer: CustomerContact;
  items: OrderItem[];
  subtotal: number;
  discount: AppliedDiscountCode | null;
  shipping: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type SerializedCheckoutOrder = Omit<CheckoutOrder, 'createdAt' | 'updatedAt'> & {
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export interface OrderFilters {
  status: OrderStatus | 'all';
  query: string;
}

export interface CreateOrderPayload {
  customer: CustomerContact;
  items: OrderRequestItem[];
  discountCode: string | null;
}

export interface UpdateOrderStatusPayload {
  orderId: string;
  status: OrderStatus;
}

export function normalizeOrderStatus(status: string | null | undefined): OrderStatus {
  switch (status) {
    case 'accepted':
    case 'shipped':
    case 'delivered':
    case 'cancelled':
    case 'in_factory':
      return status;
    case 'new':
    case 'confirmed':
    case 'prepared':
      return legacyToModernStatus(status);
    case 'completed':
      return 'delivered';
    default:
      return 'in_factory';
  }
}

export function isOrderActive(status: OrderStatus): boolean {
  return status !== 'delivered' && status !== 'cancelled';
}

export function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'in_factory':
      return 'En fábrica';
    case 'accepted':
      return 'Aceptado';
    case 'shipped':
      return 'Enviado';
    case 'delivered':
      return 'Entregado';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

export function cartItemToOrderItem(item: CartItem, campaigns: Campaign[]): OrderItem {
  const pricing = resolveProductPricing(item.product, campaigns);
  const unitPrice = pricing.effectivePrice;

  return {
    productId: item.product.id,
    productName: item.product.name,
    imageUrl: item.product.imageUrl,
    category: item.product.category,
    categorySlug: item.product.categorySlug,
    subcategory: item.product.subcategory,
    subcategorySlug: item.product.subcategorySlug,
    collection: item.product.collection,
    collectionSlug: item.product.collectionSlug,
    campaignId: pricing.source === 'campaign' && pricing.hasDiscount ? pricing.campaignId : null,
    campaignName: pricing.source === 'campaign' && pricing.hasDiscount ? pricing.campaignName : null,
    quantity: item.quantity,
    variant: item.variant,
    unitPrice,
    lineTotal: unitPrice * item.quantity,
  };
}

function legacyToModernStatus(status: 'new' | 'confirmed' | 'prepared'): OrderStatus {
  switch (status) {
    case 'new':
      return 'in_factory';
    case 'confirmed':
      return 'accepted';
    case 'prepared':
      return 'shipped';
    default:
      return 'in_factory';
  }
}
