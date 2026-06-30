export type CampaignDiscountType = 'percentage' | 'fixed';
export type CampaignLifecycle = 'active' | 'scheduled' | 'ended' | 'inactive';

export interface Campaign {
  id: string;
  name: string;
  badge: string;
  description: string;
  discountType: CampaignDiscountType;
  discountValue: number;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
}

export type CampaignDraft = Omit<Campaign, 'id'> & {
  id?: string;
};

export function isCampaignActive(campaign: Campaign, now = new Date()): boolean {
  if (!campaign.active) {
    return false;
  }

  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) {
    return false;
  }

  if (campaign.endsAt && campaign.endsAt.getTime() < now.getTime()) {
    return false;
  }

  return true;
}

export function getCampaignLifecycle(campaign: Campaign, now = new Date()): CampaignLifecycle {
  if (!campaign.active) {
    return 'inactive';
  }

  if (campaign.startsAt && campaign.startsAt.getTime() > now.getTime()) {
    return 'scheduled';
  }

  if (campaign.endsAt && campaign.endsAt.getTime() < now.getTime()) {
    return 'ended';
  }

  return 'active';
}
