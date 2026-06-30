import { environment } from '../../../environments/environment';

export const isFirebaseConfigured =
  environment.firebase.enabled &&
  !!environment.firebase.config.apiKey &&
  !!environment.firebase.config.authDomain &&
  !!environment.firebase.config.projectId &&
  !!environment.firebase.config.storageBucket &&
  !!environment.firebase.config.messagingSenderId &&
  !!environment.firebase.config.appId;

export const authMode = isFirebaseConfigured ? 'firebase' : 'mock';

export const firestoreCollections = {
  campaigns: 'campaigns',
  orders: 'orders',
  products: 'products',
} as const;

export function isAdminEmail(email: string): boolean {
  const normalizedEmail = email.toLowerCase();

  return environment.firebase.adminEmails.some(
    (adminEmail) => adminEmail.toLowerCase() === normalizedEmail,
  );
}
