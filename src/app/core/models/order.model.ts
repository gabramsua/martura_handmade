import { CartItem } from './cart.model';

export interface CustomerContact {
  name: string;
  email: string;
  phone: string;
  city: string;
  notes: string | null;
}

export interface OrderItem {
  productId: string;
  productName: string;
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
  status: 'draft' | 'sent';
  createdAt: Date;
}

export interface OrderFilters {
  status: CheckoutOrder['status'] | 'all';
}

export function cartItemToOrderItem(item: CartItem): OrderItem {
  const unitPrice = item.product.offerPrice ?? item.product.originalPrice;

  return {
    productId: item.product.id,
    productName: item.product.name,
    quantity: item.quantity,
    variant: item.variant,
    unitPrice,
    lineTotal: unitPrice * item.quantity,
  };
}
