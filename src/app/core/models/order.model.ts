import { CartItem } from './cart.model';
import { Campaign } from './campaign.model';
import { resolveProductPricing } from '../utils/product-pricing';

export type DeliveryMethod = 'shipping' | 'pickup';
export type OrderStatus = 'new' | 'confirmed' | 'prepared' | 'completed' | 'cancelled';

export interface CustomerContact {
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

export interface OrderItem {
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

export interface OrderRequestItem {
  productId: string;
  quantity: number;
  variant: string;
}

export interface CheckoutOrder {
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

export type SerializedCheckoutOrder = Omit<CheckoutOrder, 'createdAt' | 'updatedAt'> & {
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};

export interface OrderFilters {
  status: OrderStatus | 'all';
  deliveryMethod: DeliveryMethod | 'all';
  query: string;
}

export interface CreateOrderPayload {
  customer: CustomerContact;
  items: OrderRequestItem[];
}

export interface UpdateOrderStatusPayload {
  orderId: string;
  status: OrderStatus;
}

export function normalizeOrderStatus(status: string | null | undefined): OrderStatus {
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

export function isOrderActive(status: OrderStatus): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

export function getOrderStatusLabel(
  status: OrderStatus,
  deliveryMethod: DeliveryMethod,
): string {
  switch (status) {
    case 'new':
      return 'Nuevo';
    case 'confirmed':
      return 'Confirmado';
    case 'prepared':
      return deliveryMethod === 'shipping' ? 'Preparando envío' : 'Listo para recoger';
    case 'completed':
      return deliveryMethod === 'shipping' ? 'Enviado' : 'Recogido';
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
