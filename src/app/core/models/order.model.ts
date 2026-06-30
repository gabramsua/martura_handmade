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
  quantity: number;
  variant: string;
  unitPrice: number;
  lineTotal: number;
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

export interface OrderFilters {
  status: OrderStatus | 'all';
  deliveryMethod: DeliveryMethod | 'all';
  query: string;
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
      return deliveryMethod === 'shipping' ? 'Preparando envio' : 'Listo para recoger';
    case 'completed':
      return deliveryMethod === 'shipping' ? 'Enviado' : 'Recogido';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

export function cartItemToOrderItem(item: CartItem, campaigns: Campaign[]): OrderItem {
  const unitPrice = resolveProductPricing(item.product, campaigns).effectivePrice;

  return {
    productId: item.product.id,
    productName: item.product.name,
    imageUrl: item.product.imageUrl,
    quantity: item.quantity,
    variant: item.variant,
    unitPrice,
    lineTotal: unitPrice * item.quantity,
  };
}
