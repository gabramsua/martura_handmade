import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from '@angular/fire/firestore';
import { BehaviorSubject, map } from 'rxjs';

import { MOCK_CAMPAIGNS } from '../data/mock-campaigns';
import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { reviveCampaign } from '../firebase/firestore.mappers';
import {
  Campaign,
  CampaignDraft,
  CampaignLifecycle,
  getCampaignLifecycle,
  isCampaignActive,
} from '../models/campaign.model';
import { slugify } from '../utils/slug';
import { LocalStorageService } from './local-storage.service';

const CAMPAIGNS_STORAGE_KEY = 'martura_campaigns';

@Injectable({ providedIn: 'root' })
export class CampaignsService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly campaignsSubject = new BehaviorSubject<Campaign[]>(
    this.readInitialCampaigns(),
  );
  private readonly loadingSubject = new BehaviorSubject<boolean>(
    isFirebaseConfigured && !!this.firestore,
  );

  readonly loading$ = this.loadingSubject.asObservable();
  readonly campaigns$ = this.campaignsSubject.asObservable();
  readonly activeCampaigns$ = this.campaigns$.pipe(
    map((campaigns) => campaigns.filter((campaign) => isCampaignActive(campaign))),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    const campaignsCollection = collection(this.firestore, firestoreCollections.campaigns);
    const campaignsQuery = query(campaignsCollection, orderBy('startsAt', 'desc'));

    collectionData(campaignsQuery, { idField: 'id' }).subscribe({
      next: (campaigns) => {
        const nextCampaigns = (
          campaigns as Array<Campaign & { startsAt: unknown; endsAt: unknown }>
        ).map((campaign) => reviveCampaign(campaign));

        this.campaignsSubject.next(nextCampaigns);
        this.loadingSubject.next(false);
      },
      error: () => {
        this.loadingSubject.next(false);
      },
    });
  }

  get campaignsSnapshot(): Campaign[] {
    return this.campaignsSubject.value;
  }

  get activeCampaignsSnapshot(): Campaign[] {
    return this.campaignsSnapshot.filter((campaign) => isCampaignActive(campaign));
  }

  getCampaignById(campaignId: string | null): Campaign | null {
    if (!campaignId) {
      return null;
    }

    return this.campaignsSnapshot.find((campaign) => campaign.id === campaignId) ?? null;
  }

  getCampaignLifecycle(campaign: Campaign): CampaignLifecycle {
    return getCampaignLifecycle(campaign);
  }

  async createCampaign(draft: CampaignDraft): Promise<Campaign> {
    const campaign = this.draftToCampaign(draft);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getCampaignDoc(campaign.id), campaign);
      return campaign;
    }

    this.setCampaigns([campaign, ...this.campaignsSubject.value]);
    return campaign;
  }

  async updateCampaign(campaignId: string, draft: CampaignDraft): Promise<Campaign> {
    const existingCampaign = this.campaignsSubject.value.find((campaign) => campaign.id === campaignId);

    if (!existingCampaign) {
      throw new Error('No se encontró la campaña que intentas editar.');
    }

    const nextCampaign = {
      ...this.draftToCampaign(draft, existingCampaign),
      id: existingCampaign.id,
    };

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getCampaignDoc(campaignId), nextCampaign);
      return nextCampaign;
    }

    this.setCampaigns(
      this.campaignsSubject.value.map((campaign) =>
        campaign.id === campaignId ? nextCampaign : campaign,
      ),
    );

    return nextCampaign;
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      await deleteDoc(this.getCampaignDoc(campaignId));
      return;
    }

    this.setCampaigns(this.campaignsSubject.value.filter((campaign) => campaign.id !== campaignId));
  }

  async resetCampaigns(): Promise<void> {
    if (isFirebaseConfigured && this.firestore) {
      const batch = writeBatch(this.firestore);

      for (const campaign of this.campaignsSubject.value) {
        batch.delete(this.getCampaignDoc(campaign.id));
      }

      for (const campaign of MOCK_CAMPAIGNS) {
        batch.set(this.getCampaignDoc(campaign.id), campaign);
      }

      await batch.commit();
      return;
    }

    this.setCampaigns(MOCK_CAMPAIGNS);
  }

  private draftToCampaign(draft: CampaignDraft, existingCampaign?: Campaign): Campaign {
    const slug = slugify(draft.badge || draft.name);

    return {
      id: existingCampaign?.id ?? draft.id ?? `cmp-${slug}-${Date.now()}`,
      name: draft.name,
      badge: draft.badge,
      description: draft.description,
      discountType: draft.discountType,
      discountValue: draft.discountValue,
      active: draft.active,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
    };
  }

  private setCampaigns(campaigns: Campaign[]): void {
    this.campaignsSubject.next(campaigns);
    this.localStorageService.write(CAMPAIGNS_STORAGE_KEY, campaigns);
  }

  private readInitialCampaigns(): Campaign[] {
    if (isFirebaseConfigured) {
      return [];
    }

    return this.localStorageService.read(CAMPAIGNS_STORAGE_KEY, MOCK_CAMPAIGNS, (campaigns) =>
      (campaigns as Array<Campaign & { startsAt: unknown; endsAt: unknown }>).map((campaign) =>
        reviveCampaign(campaign),
      ),
    );
  }

  private getCampaignDoc(campaignId: string) {
    return doc(this.firestore!, firestoreCollections.campaigns, campaignId);
  }
}
