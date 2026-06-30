import { Product } from './product.model';

export interface CartItem {
  product: Product;
  quantity: number;
  variant: string;
}

export interface CartSummary {
  items: CartItem[];
  subtotal: number;
  shipping: number;
  total: number;
  totalItems: number;
}
