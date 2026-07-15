import { Campaign } from '../models/campaign.model';
import { normalizeProductCampaignIds, Product, ProductPricingMode } from '../models/product.model';

export interface ProductPricing {
  originalPrice: number;
  effectivePrice: number;
  hasDiscount: boolean;
  source: ProductPricingMode;
  campaignId: string | null;
  badgeLabel: string | null;
  campaignName: string | null;
}

export function resolveProductPricing(
  product: Pick<Product, 'originalPrice' | 'offerPrice' | 'campaignIds' | 'pricingMode'> & { campaignId?: string | null },
  campaigns: Campaign[],
): ProductPricing {
  const basePrice = normalizeMoney(product.originalPrice);

  if (product.pricingMode === 'individual_offer' && isValidManualOffer(product.offerPrice, basePrice)) {
    return {
      originalPrice: basePrice,
      effectivePrice: normalizeMoney(product.offerPrice!),
      hasDiscount: true,
      source: 'individual_offer',
      campaignId: null,
      badgeLabel: 'Oferta',
      campaignName: null,
    };
  }

  if (product.pricingMode === 'campaign') {
    const selectedCampaign = normalizeProductCampaignIds(product)
      .map((campaignId) => campaigns.find((entry) => entry.id === campaignId) ?? null)
      .filter((campaign): campaign is Campaign => !!campaign)
      .map((campaign) => ({
        campaign,
        price: calculateCampaignPrice(basePrice, campaign),
      }))
      .filter((entry) => entry.price < basePrice)
      .sort((left, right) =>
        left.price - right.price ||
        compareNullableDates(right.campaign.startsAt, left.campaign.startsAt) ||
        left.campaign.name.localeCompare(right.campaign.name, 'es')
      )[0];

    if (selectedCampaign) {
      return {
        originalPrice: basePrice,
        effectivePrice: selectedCampaign.price,
        hasDiscount: true,
        source: 'campaign',
        campaignId: selectedCampaign.campaign.id,
        badgeLabel: selectedCampaign.campaign.badge,
        campaignName: selectedCampaign.campaign.name,
      };
    }
  }

  return {
    originalPrice: basePrice,
    effectivePrice: basePrice,
    hasDiscount: false,
    source: 'regular',
    campaignId: null,
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

function compareNullableDates(left: Date | null, right: Date | null): number {
  const leftTime = left?.getTime() ?? 0;
  const rightTime = right?.getTime() ?? 0;
  return leftTime - rightTime;
}
