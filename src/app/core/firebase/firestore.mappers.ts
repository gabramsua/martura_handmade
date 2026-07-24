import { Campaign } from '../models/campaign.model';
import { CustomerProfile } from '../models/customer.model';
import { CheckoutOrder, normalizeOrderStatus } from '../models/order.model';
import {
  normalizePricingMode,
  normalizeProductCampaignIds,
  normalizeProductStatus,
  Product,
} from '../models/product.model';
import { CatalogTaxonomy } from '../models/taxonomy.model';

type WithUnknownDate<T> = Omit<T, 'createdAt'> & {
  createdAt: unknown;
};

type WithUnknownProductDate = Omit<Product, 'createdAt' | 'campaignIds'> & {
  createdAt: unknown;
  campaignIds?: unknown;
  campaignId?: unknown;
};

type WithUnknownOrderDates = Omit<CheckoutOrder, 'createdAt' | 'updatedAt'> & {
  createdAt: unknown;
  updatedAt?: unknown;
};

type WithUnknownCustomerDates = Omit<CustomerProfile, 'createdAt' | 'updatedAt' | 'lastOrderAt'> & {
  createdAt: unknown;
  updatedAt: unknown;
  lastOrderAt?: unknown;
};

type WithUnknownTaxonomyDates = Omit<CatalogTaxonomy, 'createdAt' | 'updatedAt'> & {
  createdAt: unknown;
  updatedAt: unknown;
};

export function reviveProduct(product: WithUnknownProductDate): Product {
  const campaignIds = normalizeProductCampaignIds({
    campaignIds: Array.isArray(product.campaignIds) ? product.campaignIds : [],
    campaignId: typeof product.campaignId === 'string' ? product.campaignId : null,
  });
  const gallery =
    Array.isArray(product.gallery) && product.gallery.length > 0
      ? product.gallery.filter((image): image is string => typeof image === 'string' && image.trim().length > 0)
      : [];
  const imageUrl =
    typeof product.imageUrl === 'string' && product.imageUrl.trim().length > 0
      ? product.imageUrl
      : gallery[0] ?? '';

  return {
    ...product,
    imageUrl,
    gallery: gallery.length > 0 ? gallery : imageUrl ? [imageUrl] : [],
    subcategory: product.subcategory ?? null,
    subcategorySlug: product.subcategorySlug ?? null,
    collection: product.collection ?? null,
    collectionSlug: product.collectionSlug ?? null,
    campaignIds,
    position: typeof product.position === 'number' ? product.position : 0,
    pricingMode: normalizePricingMode({
      pricingMode: product.pricingMode,
      offerPrice: product.offerPrice ?? null,
      campaignIds,
      campaignId: typeof product.campaignId === 'string' ? product.campaignId : null,
    }),
    status: normalizeProductStatus(product.status, typeof product.stock === 'number' ? product.stock : 0),
    createdAt: normalizeDate(product.createdAt),
  };
}

export function reviveOrder(order: WithUnknownOrderDates): CheckoutOrder {
  const createdAt = normalizeDate(order.createdAt);
  const legacyCustomer = order.customer as typeof order.customer & { notes?: string | null };

  return {
    ...order,
    customer: {
      ...legacyCustomer,
      deliveryMethod: 'shipping',
      dni: order.customer.dni ?? '',
      addressLine1: order.customer.addressLine1 ?? '',
      postalCode: order.customer.postalCode ?? '',
      city: order.customer.city ?? '',
      province: order.customer.province ?? '',
      comments: order.customer.comments ?? legacyCustomer.notes ?? null,
    },
    discount: order.discount ?? null,
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

export function reviveCustomerProfile(customer: WithUnknownCustomerDates): CustomerProfile {
  return {
    ...customer,
    phone: customer.phone ?? null,
    deliveryMethodPreference: customer.deliveryMethodPreference === 'shipping' ? 'shipping' : null,
    addressLine1: customer.addressLine1 ?? null,
    postalCode: customer.postalCode ?? '',
    city: customer.city ?? '',
    province: customer.province ?? '',
    notes: customer.notes ?? null,
    totalOrders: typeof customer.totalOrders === 'number' ? customer.totalOrders : 0,
    totalSpent: typeof customer.totalSpent === 'number' ? customer.totalSpent : 0,
    lastOrderId: customer.lastOrderId ?? null,
    lastOrderStatus: normalizeNullableOrderStatus(customer.lastOrderStatus),
    lastOrderAt: normalizeNullableDate(customer.lastOrderAt),
    createdAt: normalizeDate(customer.createdAt),
    updatedAt: normalizeDate(customer.updatedAt),
  };
}

export function reviveTaxonomy(taxonomy: WithUnknownTaxonomyDates): CatalogTaxonomy {
  return {
    ...taxonomy,
    position: typeof taxonomy.position === 'number' ? taxonomy.position : 0,
    createdAt: normalizeDate(taxonomy.createdAt),
    updatedAt: normalizeDate(taxonomy.updatedAt),
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

function normalizeNullableOrderStatus(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return normalizeOrderStatus(String(value));
}
