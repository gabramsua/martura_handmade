import { Injectable } from '@angular/core';

import { isFirebaseConfigured } from '../firebase/firebase.config';
import { getMarturaFunctions } from '../firebase/firebase.lazy';

@Injectable({ providedIn: 'root' })
export class AdminMaintenanceService {
  async wipeStoreData(): Promise<void> {
    if (isFirebaseConfigured) {
      const functions = await getMarturaFunctions();

      if (!functions) {
        throw new Error('Firebase Functions no está disponible en este entorno.');
      }

      const { httpsCallable } = await import('firebase/functions');
      const wipeStoreData = httpsCallable<undefined, { ok: boolean }>(functions, 'wipeStoreData');
      await wipeStoreData();
    }

    this.clearLocalState();
  }

  private clearLocalState(): void {
    const keysToRemove: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (key?.startsWith('martura_')) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  }
}
