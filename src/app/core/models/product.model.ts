export type ProductStatus = 'active' | 'sold_out' | 'hidden';
export type ProductSort = 'newest' | 'price-asc' | 'price-desc' | 'name';
export type ProductPricingMode = 'regular' | 'individual_offer' | 'campaign';

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  story: string;
  originalPrice: number;
  offerPrice: number | null;
  imageUrl: string;
  gallery: string[];
  category: string;
  categorySlug: string;
  collection: string | null;
  collectionSlug: string | null;
  stock: number;
  sizes: string[];
  colors: string[];
  pricingMode: ProductPricingMode;
  campaignId: string | null;
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

export function normalizePricingMode(product: Pick<Product, 'pricingMode' | 'offerPrice' | 'campaignId'>): ProductPricingMode {
  if (product.pricingMode) {
    return product.pricingMode;
  }

  if (product.campaignId && product.campaignId !== 'cmp-manual') {
    return 'campaign';
  }

  if (product.offerPrice !== null) {
    return 'individual_offer';
  }

  return 'regular';
}
