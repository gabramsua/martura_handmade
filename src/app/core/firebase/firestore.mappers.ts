import { Campaign } from '../models/campaign.model';
import { CheckoutOrder, normalizeOrderStatus } from '../models/order.model';
import { normalizePricingMode, normalizeProductStatus, Product } from '../models/product.model';

type WithUnknownDate<T> = Omit<T, 'createdAt'> & {
  createdAt: unknown;
};

type WithUnknownOrderDates = Omit<CheckoutOrder, 'createdAt' | 'updatedAt'> & {
  createdAt: unknown;
  updatedAt?: unknown;
};

export function reviveProduct(product: WithUnknownDate<Product>): Product {
  return {
    ...product,
    gallery: Array.isArray(product.gallery) && product.gallery.length > 0 ? product.gallery : [product.imageUrl],
    collection: product.collection ?? null,
    collectionSlug: product.collectionSlug ?? null,
    pricingMode: normalizePricingMode(product),
    status: normalizeProductStatus(product.status, typeof product.stock === 'number' ? product.stock : 0),
    createdAt: normalizeDate(product.createdAt),
  };
}

export function reviveOrder(order: WithUnknownOrderDates): CheckoutOrder {
  const createdAt = normalizeDate(order.createdAt);

  return {
    ...order,
    customer: {
      ...order.customer,
      deliveryMethod: order.customer.deliveryMethod === 'pickup' ? 'pickup' : 'shipping',
      addressLine1: order.customer.addressLine1 ?? null,
      postalCode: order.customer.postalCode ?? '',
      city: order.customer.city ?? '',
      province: order.customer.province ?? '',
      notes: order.customer.notes ?? null,
    },
    status: normalizeOrderStatus(order.status),
    createdAt,
    updatedAt: normalizeNullableDate(order.updatedAt) ?? createdAt,
  };
}

export function reviveCampaign(
  campaign: Omit<Campaign, 'startsAt' | 'endsAt'> & { startsAt: unknown; endsAt: unknown },
): Campaign {
  return {
    ...campaign,
    startsAt: normalizeNullableDate(campaign.startsAt),
    endsAt: normalizeNullableDate(campaign.endsAt),
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

function normalizeNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizeDate(value);
}
