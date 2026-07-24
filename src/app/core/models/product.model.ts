export type ProductStatus = 'active' | 'sold_out' | 'hidden';
export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name';
export type ProductPricingMode = 'regular' | 'individual_offer' | 'campaign';

export interface Product {
  id: string;
  name: string;
  slug: string;
  position: number;
  description: string;
  story: string;
  originalPrice: number;
  offerPrice: number | null;
  imageUrl: string;
  gallery: string[];
  category: string;
  categorySlug: string;
  subcategory: string | null;
  subcategorySlug: string | null;
  collection: string | null;
  collectionSlug: string | null;
  stock: number;
  sizes: string[];
  colors: string[];
  pricingMode: ProductPricingMode;
  campaignIds: string[];
  featured: boolean;
  status: ProductStatus;
  createdAt: Date;
}

export type ProductDraft = Omit<Product, 'id' | 'slug' | 'createdAt'> & {
  id?: string;
  slug?: string;
};

export interface ProductFilters {
  categorySlug: string | null;
  subcategorySlug: string | null;
  collectionSlug: string | null;
  query: string;
  onlyOffers: boolean;
  sortBy: ProductSort;
}

export function normalizeProductStatus(
  status: ProductStatus | null | undefined,
  stock: number,
): ProductStatus {
  if (status === 'hidden') {
    return 'hidden';
  }

  if (stock <= 0) {
    return 'sold_out';
  }

  return 'active';
}

export function isProductVisible(product: Pick<Product, 'status'>): boolean {
  return product.status !== 'hidden';
}

export function isProductAvailable(product: Pick<Product, 'status' | 'stock'>): boolean {
  return product.status === 'active' && product.stock > 0;
}

export function normalizeProductCampaignIds(
  product: Partial<Pick<Product, 'campaignIds'>> & { campaignId?: string | null | undefined },
): string[] {
  const explicitCampaignIds = Array.isArray(product.campaignIds)
    ? product.campaignIds.filter((campaignId): campaignId is string => typeof campaignId === 'string')
    : [];
  const legacyCampaignId = typeof product.campaignId === 'string' ? product.campaignId.trim() : '';

  return Array.from(new Set([...explicitCampaignIds, legacyCampaignId].map((campaignId) => campaignId.trim()).filter(Boolean)));
}

export function normalizePricingMode(
  product: Pick<Product, 'pricingMode' | 'offerPrice' | 'campaignIds'> & { campaignId?: string | null },
): ProductPricingMode {
  if (product.pricingMode) {
    return product.pricingMode;
  }

  if (normalizeProductCampaignIds(product).length > 0) {
    return 'campaign';
  }

  if (product.offerPrice !== null) {
    return 'individual_offer';
  }

  return 'regular';
}
