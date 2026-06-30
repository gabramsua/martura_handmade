import { CheckoutOrder } from '../models/order.model';
import { Product } from '../models/product.model';

type WithUnknownDate<T> = Omit<T, 'createdAt'> & {
  createdAt: unknown;
};

export function reviveProduct(product: WithUnknownDate<Product>): Product {
  return {
    ...product,
    createdAt: normalizeDate(product.createdAt),
  };
}

export function reviveOrder(order: WithUnknownDate<CheckoutOrder>): CheckoutOrder {
  return {
    ...order,
    createdAt: normalizeDate(order.createdAt),
  };
}

function normalizeDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate() as Date;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value);
  }

  return new Date();
}
