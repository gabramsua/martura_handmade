import { environment } from '../../../environments/environment';
import { isFirebaseConfigured } from './firebase.config';

let functionsPromise: Promise<any | null> | null = null;
let authPromise: Promise<any | null> | null = null;
let storagePromise: Promise<any | null> | null = null;
let authEmulatorConnected = false;
let functionsEmulatorConnected = false;
let storageEmulatorConnected = false;

export async function getMarturaAuth(): Promise<any | null> {
  if (!isFirebaseConfigured) {
    return null;
  }

  if (!authPromise) {
    authPromise = (async () => {
      const { connectAuthEmulator, getAuth } = await import('firebase/auth');
      const auth = getAuth();

      if (environment.firebase.useEmulators && !authEmulatorConnected) {
        connectAuthEmulator(auth, `http://${environment.firebase.emulators.authHost}:${environment.firebase.emulators.authPort}`, {
          disableWarnings: true,
        });
        authEmulatorConnected = true;
      }

      return auth;
    })();
  }

  return authPromise;
}

export async function getMarturaFunctions(): Promise<any | null> {
  if (!isFirebaseConfigured) {
    return null;
  }

  if (!functionsPromise) {
    functionsPromise = (async () => {
      const { connectFunctionsEmulator, getFunctions } = await import('firebase/functions');
      const functions = getFunctions(undefined, 'europe-west1');

      if (environment.firebase.useEmulators && !functionsEmulatorConnected) {
        connectFunctionsEmulator(
          functions,
          environment.firebase.emulators.functionsHost,
          environment.firebase.emulators.functionsPort,
        );
        functionsEmulatorConnected = true;
      }

      return functions;
    })();
  }

  return functionsPromise;
}

export async function getMarturaStorage(): Promise<any | null> {
  if (!isFirebaseConfigured) {
    return null;
  }

  if (!storagePromise) {
    storagePromise = (async () => {
      const { connectStorageEmulator, getStorage } = await import('firebase/storage');
      const storage = getStorage();

      if (environment.firebase.useEmulators && !storageEmulatorConnected) {
        connectStorageEmulator(
          storage,
          environment.firebase.emulators.storageHost,
          environment.firebase.emulators.storagePort,
        );
        storageEmulatorConnected = true;
      }

      return storage;
    })();
  }

  return storagePromise;
}
