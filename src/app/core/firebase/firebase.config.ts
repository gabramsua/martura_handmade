import { environment } from '../../../environments/environment';

export const isUsingFirebaseEmulators = environment.firebase.useEmulators;

export const isFirebaseConfigured =
  environment.firebase.enabled &&
  !!environment.firebase.config.apiKey &&
  !!environment.firebase.config.authDomain &&
  !!environment.firebase.config.projectId &&
  !!environment.firebase.config.storageBucket &&
  !!environment.firebase.config.messagingSenderId &&
  !!environment.firebase.config.appId;

export const authMode = !isFirebaseConfigured
  ? 'mock'
  : isUsingFirebaseEmulators
    ? 'emulator'
    : 'firebase';

export const primaryAdminEmail =
  environment.firebase.primaryAdminEmail || environment.firebase.adminEmails[0] || '';

export const firestoreCollections = {
  campaigns: 'campaigns',
  contactMessages: 'contactMessages',
  customers: 'customers',
  discountCodes: 'discountCodes',
  orders: 'orders',
  productCategories: 'productCategories',
  productSubcategories: 'productSubcategories',
  productCollections: 'productCollections',
  products: 'products',
  shopSettings: 'shopSettings',
} as const;

export function isAdminEmail(email: string): boolean {
  const normalizedEmail = email.toLowerCase();

  return environment.firebase.adminEmails.some(
    (adminEmail) => adminEmail.toLowerCase() === normalizedEmail,
  );
}
