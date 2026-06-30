import { Campaign } from '../models/campaign.model';
import { Product, ProductPricingMode } from '../models/product.model';

export interface ProductPricing {
  originalPrice: number;
  effectivePrice: number;
  hasDiscount: boolean;
  source: ProductPricingMode;
  badgeLabel: string | null;
  campaignName: string | null;
}

export function resolveProductPricing(
  product: Pick<Product, 'originalPrice' | 'offerPrice' | 'campaignId' | 'pricingMode'>,
  campaigns: Campaign[],
): ProductPricing {
  const basePrice = normalizeMoney(product.originalPrice);

  if (product.pricingMode === 'individual_offer' && isValidManualOffer(product.offerPrice, basePrice)) {
    return {
      originalPrice: basePrice,
      effectivePrice: normalizeMoney(product.offerPrice!),
      hasDiscount: true,
      source: 'individual_offer',
      badgeLabel: 'Oferta',
      campaignName: null,
    };
  }

  if (product.pricingMode === 'campaign' && product.campaignId) {
    const campaign = campaigns.find((entry) => entry.id === product.campaignId);

    if (campaign) {
      const campaignPrice = calculateCampaignPrice(basePrice, campaign);

      if (campaignPrice < basePrice) {
        return {
          originalPrice: basePrice,
          effectivePrice: campaignPrice,
          hasDiscount: true,
          source: 'campaign',
          badgeLabel: campaign.badge,
          campaignName: campaign.name,
        };
      }
    }
  }

  return {
    originalPrice: basePrice,
    effectivePrice: basePrice,
    hasDiscount: false,
    source: 'regular',
    badgeLabel: null,
    campaignName: null,
  };
}

function calculateCampaignPrice(basePrice: number, campaign: Campaign): number {
  if (campaign.discountType === 'fixed') {
    return normalizeMoney(Math.max(0, basePrice - campaign.discountValue));
  }

  return normalizeMoney(basePrice * (1 - campaign.discountValue / 100));
}

function isValidManualOffer(offerPrice: number | null, originalPrice: number): boolean {
  return typeof offerPrice === 'number' && offerPrice > 0 && offerPrice < originalPrice;
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
