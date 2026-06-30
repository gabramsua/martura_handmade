import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { provideAuth } from '@angular/fire/auth';
import { provideFirebaseApp } from '@angular/fire/app';
import { provideFirestore } from '@angular/fire/firestore';
import { provideStorage } from '@angular/fire/storage';

import { environment } from '../../../environments/environment';
import { isFirebaseConfigured } from './firebase.config';

export function provideMarturaFirebase(): EnvironmentProviders {
  if (!isFirebaseConfigured) {
    return makeEnvironmentProviders([]);
  }

  const {
    authHost,
    authPort,
    firestoreHost,
    firestorePort,
    storageHost,
    storagePort,
  } = environment.firebase.emulators;

  return makeEnvironmentProviders([
    provideFirebaseApp(() => initializeApp(environment.firebase.config)),
    provideAuth(() => {
      const auth = getAuth();

      if (environment.firebase.useEmulators) {
        connectAuthEmulator(auth, `http://${authHost}:${authPort}`, {
          disableWarnings: true,
        });
      }

      return auth;
    }),
    provideFirestore(() => {
      const firestore = getFirestore();

      if (environment.firebase.useEmulators) {
        connectFirestoreEmulator(firestore, firestoreHost, firestorePort);
      }

      return firestore;
    }),
    provideStorage(() => {
      const storage = getStorage();

      if (environment.firebase.useEmulators) {
        connectStorageEmulator(storage, storageHost, storagePort);
      }

      return storage;
    }),
  ]);
}
