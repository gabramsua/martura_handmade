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
  stock: number;
  sizes: string[];
  colors: string[];
  campaignId: string | null;
  featured: boolean;
  createdAt: Date;
}

export type ProductDraft = Omit<Product, 'id' | 'slug' | 'createdAt'> & {
  id?: string;
  slug?: string;
};

export interface ProductFilters {
  categorySlug: string | null;
  query: string;
  onlyOffers: boolean;
}
