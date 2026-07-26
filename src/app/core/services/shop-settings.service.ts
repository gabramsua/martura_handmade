import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
} from '@angular/fire/firestore';
import { BehaviorSubject, map } from 'rxjs';

import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import {
  AboutArticle,
  DEFAULT_SHOP_SETTINGS,
  HeroSlide,
  ShopSettings,
  ShopSettingsDraft,
} from '../models/shop-settings.model';
import { LocalStorageService } from './local-storage.service';

const SETTINGS_STORAGE_KEY = 'martura_shop_settings';

@Injectable({ providedIn: 'root' })
export class ShopSettingsService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly settingsSubject = new BehaviorSubject<ShopSettings>(this.readInitialSettings());
  private readonly loadingSubject = new BehaviorSubject<boolean>(isFirebaseConfigured && !!this.firestore);

  readonly settings$ = this.settingsSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly heroSlides$ = this.settings$.pipe(
    map((settings) =>
      [...settings.heroSlides]
        .filter((slide) => slide.active)
        .sort((left, right) => left.position - right.position),
    ),
  );
  readonly aboutArticles$ = this.settings$.pipe(
    map((settings) =>
      [...settings.aboutArticles].sort((left, right) => left.position - right.position),
    ),
  );

  constructor() {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    collectionData(collection(this.firestore, firestoreCollections.shopSettings), { idField: 'id' }).subscribe({
      next: (entries) => {
        const [entry] = entries;
        this.settingsSubject.next(this.reviveSettings((entry as Partial<ShopSettings> | undefined) ?? null));
        this.loadingSubject.next(false);
      },
      error: () => {
        this.loadingSubject.next(false);
      },
    });
  }

  get settingsSnapshot(): ShopSettings {
    return this.settingsSubject.value;
  }

  async saveSettings(draft: ShopSettingsDraft): Promise<void> {
    const nextSettings = this.toSettings(draft);

    if (isFirebaseConfigured && this.firestore) {
      await setDoc(this.getSettingsDoc(nextSettings.id), nextSettings);
      return;
    }

    this.settingsSubject.next(nextSettings);
    this.localStorageService.write(SETTINGS_STORAGE_KEY, nextSettings);
  }

  private readInitialSettings(): ShopSettings {
    if (isFirebaseConfigured) {
      return DEFAULT_SHOP_SETTINGS;
    }

    return this.localStorageService.read<ShopSettings>(
      SETTINGS_STORAGE_KEY,
      DEFAULT_SHOP_SETTINGS,
      (value) => this.reviveSettings(value),
    );
  }

  private reviveSettings(value: Partial<ShopSettings> | null): ShopSettings {
    const fallbackAboutArticles = this.buildDefaultAboutArticles(value);
    const aboutArticles = Array.isArray(value?.aboutArticles)
      ? value.aboutArticles.map((article, index) => this.reviveAboutArticle(article, index, fallbackAboutArticles))
      : fallbackAboutArticles;
    const heroSlides = Array.isArray(value?.heroSlides)
      ? value.heroSlides.map((slide, index) => this.reviveSlide(slide, index))
      : DEFAULT_SHOP_SETTINGS.heroSlides;

    return {
      id: typeof value?.id === 'string' && value.id.trim() ? value.id : DEFAULT_SHOP_SETTINGS.id,
      bizumPhone:
        typeof value?.bizumPhone === 'string' && value.bizumPhone.trim()
          ? value.bizumPhone.trim()
          : DEFAULT_SHOP_SETTINGS.bizumPhone,
      shippingPrice:
        typeof value?.shippingPrice === 'number' && Number.isFinite(value.shippingPrice)
          ? Math.max(0, value.shippingPrice)
          : DEFAULT_SHOP_SETTINGS.shippingPrice,
      contactEmail:
        typeof value?.contactEmail === 'string' && value.contactEmail.trim()
          ? value.contactEmail.trim()
          : DEFAULT_SHOP_SETTINGS.contactEmail,
      aboutTitle:
        typeof value?.aboutTitle === 'string' && value.aboutTitle.trim()
          ? value.aboutTitle.trim()
          : DEFAULT_SHOP_SETTINGS.aboutTitle,
      aboutBody:
        typeof value?.aboutBody === 'string' && value.aboutBody.trim()
          ? value.aboutBody.trim()
          : DEFAULT_SHOP_SETTINGS.aboutBody,
      aboutArticles,
      heroSlides,
    };
  }

  private reviveAboutArticle(
    value: Partial<AboutArticle>,
    index: number,
    fallbackArticles: AboutArticle[],
  ): AboutArticle {
    const fallback = fallbackArticles[index] ?? fallbackArticles[0];

    return {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : `about-${index + 1}`,
      eyebrow:
        typeof value.eyebrow === 'string' && value.eyebrow.trim() ? value.eyebrow.trim() : fallback.eyebrow,
      title:
        typeof value.title === 'string' && value.title.trim() ? value.title.trim() : fallback.title,
      body:
        typeof value.body === 'string' && value.body.trim() ? value.body.trim() : fallback.body,
      position:
        typeof value.position === 'number' && Number.isFinite(value.position) ? value.position : (index + 1) * 10,
    };
  }

  private buildDefaultAboutArticles(value: Partial<ShopSettings> | null): AboutArticle[] {
    const contactEmail =
      typeof value?.contactEmail === 'string' && value.contactEmail.trim()
        ? value.contactEmail.trim()
        : DEFAULT_SHOP_SETTINGS.contactEmail;
    const bizumPhone =
      typeof value?.bizumPhone === 'string' && value.bizumPhone.trim()
        ? value.bizumPhone.trim()
        : DEFAULT_SHOP_SETTINGS.bizumPhone;

    return [
      {
        ...DEFAULT_SHOP_SETTINGS.aboutArticles[0],
      },
      {
        ...DEFAULT_SHOP_SETTINGS.aboutArticles[1],
        title: contactEmail,
      },
      {
        ...DEFAULT_SHOP_SETTINGS.aboutArticles[2],
        title: `Bizum al ${bizumPhone}`,
      },
    ];
  }

  private reviveSlide(value: Partial<HeroSlide>, index: number): HeroSlide {
    const fallback = DEFAULT_SHOP_SETTINGS.heroSlides[index] ?? DEFAULT_SHOP_SETTINGS.heroSlides[0];

    return {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : `hero-${index + 1}`,
      imageUrl:
        typeof value.imageUrl === 'string' && value.imageUrl.trim() ? value.imageUrl.trim() : fallback.imageUrl,
      headline:
        typeof value.headline === 'string' && value.headline.trim() ? value.headline.trim() : fallback.headline,
      caption:
        typeof value.caption === 'string' && value.caption.trim() ? value.caption.trim() : fallback.caption,
      position:
        typeof value.position === 'number' && Number.isFinite(value.position) ? value.position : (index + 1) * 10,
      active: value.active !== false,
    };
  }

  private toSettings(draft: ShopSettingsDraft): ShopSettings {
    return this.reviveSettings({
      ...draft,
      id: draft.id ?? DEFAULT_SHOP_SETTINGS.id,
      aboutArticles: draft.aboutArticles,
      heroSlides: draft.heroSlides,
    });
  }

  private getSettingsDoc(settingsId: string) {
    return doc(this.firestore!, firestoreCollections.shopSettings, settingsId);
  }
}
