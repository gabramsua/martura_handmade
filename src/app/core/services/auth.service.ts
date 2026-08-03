import { Injectable, inject } from '@angular/core';
import {
  Auth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { BehaviorSubject, map } from 'rxjs';

import { AppUser, LoginCredentials } from '../models/user.model';
import { authMode, isAdminEmail, isFirebaseConfigured, isUsingFirebaseEmulators } from '../firebase/firebase.config';
import { slugify } from '../utils/slug';
import { LocalStorageService } from './local-storage.service';

const STORAGE_KEY = 'martura_mock_user';
const EMULATOR_PASSWORD = 'MarturaDev123!';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebaseAuth = inject(Auth, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly userSubject = new BehaviorSubject<AppUser | null>(this.readStoredUser());
  private readonly readyFallbackMs = 1500;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  private resolveReady: () => void = () => undefined;
  private readyResolved = false;
  private readonly readyFallbackTimer =
    typeof window === 'undefined'
      ? null
      : window.setTimeout(() => this.markReady(), this.readyFallbackMs);

  readonly user$ = this.userSubject.asObservable();
  readonly isAuthenticated$ = this.user$.pipe(map((user) => user !== null));
  readonly isAdmin$ = this.user$.pipe(map((user) => user?.role === 'admin'));
  readonly mode = authMode;

  constructor() {
    if (!isFirebaseConfigured || !this.firebaseAuth) {
      this.markReady();
      return;
    }

    onAuthStateChanged(this.firebaseAuth, (firebaseUser) => {
      if (!firebaseUser) {
        this.userSubject.next(null);
        this.markReady();
        return;
      }

      this.userSubject.next(this.mapFirebaseUser(firebaseUser));
      this.markReady();
    });
  }

  get currentUser(): AppUser | null {
    return this.userSubject.value;
  }

  async ensureReady(): Promise<void> {
    if (this.currentUser) {
      this.markReady();
    }

    await this.readyPromise;
  }

  async login(credentials: LoginCredentials): Promise<void> {
    if (isFirebaseConfigured && this.firebaseAuth) {
      try {
        if (isUsingFirebaseEmulators) {
          await this.loginWithEmulatorAccount(credentials);
          return;
        }

        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({
          prompt: 'select_account',
        });

        const { user } = await signInWithPopup(this.firebaseAuth, provider);

        if (credentials.name && user.displayName !== credentials.name) {
          await updateProfile(user, { displayName: credentials.name });
        }

        const appUser = this.mapFirebaseUser(user);

        if (credentials.role === 'admin' && appUser.role !== 'admin') {
          await signOut(this.firebaseAuth);
          throw new Error('Ese correo no tiene acceso al dashboard de Martura.');
        }

        this.userSubject.next(appUser);
        this.markReady();
        return;
      } catch (error) {
        throw this.mapAuthError(error);
      }
    }

    const user: AppUser = {
      id: `mock-${credentials.role}-${slugify(credentials.email)}`,
      name: credentials.name,
      email: credentials.email,
      role: credentials.role,
    };

    this.localStorageService.write(STORAGE_KEY, user);
    this.userSubject.next(user);
    this.markReady();
  }

  async logout(): Promise<void> {
    if (isFirebaseConfigured && this.firebaseAuth) {
      await signOut(this.firebaseAuth);
      this.userSubject.next(null);
      this.markReady();
      return;
    }

    this.localStorageService.remove(STORAGE_KEY);
    this.userSubject.next(null);
    this.markReady();
  }

  private readStoredUser(): AppUser | null {
    if (isFirebaseConfigured) {
      return null;
    }

    return this.localStorageService.read<AppUser | null>(STORAGE_KEY, null);
  }

  private mapFirebaseUser(firebaseUser: {
    uid: string;
    displayName: string | null;
    email: string | null;
  }): AppUser {
    const email = firebaseUser.email ?? '';

    return {
      id: firebaseUser.uid,
      name: firebaseUser.displayName || email || 'Usuario Martura',
      email,
      role: isAdminEmail(email) ? 'admin' : 'customer',
    };
  }

  private async loginWithEmulatorAccount(credentials: LoginCredentials): Promise<void> {
    const email = credentials.role === 'admin'
      ? credentials.email
      : credentials.email || `cliente+${Date.now()}@martura.local`;

    try {
      const { user } = await createUserWithEmailAndPassword(this.firebaseAuth!, email, EMULATOR_PASSWORD);

      if (credentials.name && user.displayName !== credentials.name) {
        await updateProfile(user, { displayName: credentials.name });
      }

      this.userSubject.next(this.mapFirebaseUser(user));
      this.markReady();
      return;
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

      if (code !== 'auth/email-already-in-use') {
        throw error;
      }
    }

    const { user } = await signInWithEmailAndPassword(this.firebaseAuth!, email, EMULATOR_PASSWORD);

    if (credentials.name && user.displayName !== credentials.name) {
      await updateProfile(user, { displayName: credentials.name });
    }

    const appUser = this.mapFirebaseUser(user);

    if (credentials.role === 'admin' && appUser.role !== 'admin') {
      await signOut(this.firebaseAuth!);
      throw new Error('Ese correo no tiene acceso al dashboard de Martura.');
    }

    this.userSubject.next(appUser);
    this.markReady();
  }

  private markReady(): void {
    if (this.readyResolved) {
      return;
    }

    if (this.readyFallbackTimer !== null) {
      window.clearTimeout(this.readyFallbackTimer);
    }

    this.readyResolved = true;
    this.resolveReady();
  }

  private mapAuthError(error: unknown): Error {
    if (error instanceof Error && error.message === 'Ese correo no tiene acceso al dashboard de Martura.') {
      return error;
    }

    const code =
      typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

    switch (code) {
      case 'auth/popup-blocked':
        return new Error('El navegador ha bloqueado la ventana de acceso. Permite las ventanas emergentes e inténtalo de nuevo.');
      case 'auth/popup-closed-by-user':
        return new Error('Has cerrado la ventana de Google antes de completar el acceso.');
      case 'auth/cancelled-popup-request':
        return new Error('Ya había un intento de acceso en curso. Espera un segundo y vuelve a intentarlo.');
      case 'auth/unauthorized-domain':
        return new Error(
          'Este dominio aún no está autorizado en Firebase Auth. Revisa Authentication > Settings > Authorized domains.',
        );
      case 'auth/account-exists-with-different-credential':
        return new Error('Ese correo ya existe con otro método de acceso en Google.');
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
        return new Error('No se pudo iniciar sesión con esas credenciales.');
      case 'auth/network-request-failed':
        return new Error('No hemos podido contactar con el servicio de acceso. Revisa tu conexión e inténtalo de nuevo.');
      case 'auth/too-many-requests':
        return new Error('Se han hecho demasiados intentos de acceso en poco tiempo. Espera un momento y vuelve a probar.');
      case 'auth/operation-not-allowed':
        return new Error('El método de acceso todavía no está habilitado en Firebase Auth.');
      default:
        return isUsingFirebaseEmulators
          ? new Error('No se pudo iniciar sesión en el emulador de Auth. Revisa que esté levantado e inténtalo de nuevo.')
          : new Error('No se pudo iniciar sesión con Google. Revisa Firebase Auth y vuelve a intentarlo.');
    }
  }
}
