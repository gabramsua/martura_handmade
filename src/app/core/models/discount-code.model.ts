export type DiscountCodeType = 'percentage' | 'fixed';
export type DiscountCodeScope = 'all' | 'products';

export interface DiscountCode {
  id: string;
  code: string;
  description: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  scope: DiscountCodeScope;
  productIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface DiscountCodeDraft extends Omit<DiscountCode, 'id'> {
  id?: string;
}

export function isDiscountCodeActive(discountCode: DiscountCode, now = new Date()): boolean {
  if (!discountCode.active) {
    return false;
  }

  if (discountCode.startsAt && discountCode.startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (discountCode.endsAt && discountCode.endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}
