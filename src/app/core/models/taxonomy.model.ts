export type TaxonomyType = 'category' | 'subcategory' | 'collection';

export interface CatalogTaxonomy {
  id: string;
  name: string;
  slug: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaxonomyDraft {
  name: string;
  position?: number;
  slug?: string;
}

export type SerializedCatalogTaxonomy = Omit<CatalogTaxonomy, 'createdAt' | 'updatedAt'> & {
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
};
