import { Injectable, inject } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { BehaviorSubject, map } from 'rxjs';

import { AppUser, LoginCredentials } from '../models/user.model';
import { authMode, isAdminEmail, isFirebaseConfigured } from '../firebase/firebase.config';
import { LocalStorageService } from './local-storage.service';

const STORAGE_KEY = 'martura_mock_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebaseAuth = inject(Auth, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);
  private readonly userSubject = new BehaviorSubject<AppUser | null>(this.readStoredUser());
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });
  private resolveReady: () => void = () => undefined;
  private readyResolved = false;

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
    await this.readyPromise;
  }

  async login(credentials: LoginCredentials): Promise<void> {
    if (isFirebaseConfigured && this.firebaseAuth) {
      const provider = new GoogleAuthProvider();
      const { user } = await signInWithPopup(this.firebaseAuth, provider);

      if (credentials.name && user.displayName !== credentials.name) {
        await updateProfile(user, { displayName: credentials.name });
      }

      const appUser = this.mapFirebaseUser(user);

      if (credentials.role === 'admin' && appUser.role !== 'admin') {
        await signOut(this.firebaseAuth);
        throw new Error('La cuenta usada no tiene rol de admin en la configuracion actual.');
      }

      this.userSubject.next(appUser);
      return;
    }

    const user: AppUser = {
      id: `mock-${credentials.role}-${this.slugify(credentials.email)}`,
      name: credentials.name,
      email: credentials.email,
      role: credentials.role,
    };

    this.localStorageService.write(STORAGE_KEY, user);
    this.userSubject.next(user);
  }

  async logout(): Promise<void> {
    if (isFirebaseConfigured && this.firebaseAuth) {
      await signOut(this.firebaseAuth);
      this.userSubject.next(null);
      return;
    }

    this.localStorageService.remove(STORAGE_KEY);
    this.userSubject.next(null);
  }

  private readStoredUser(): AppUser | null {
    if (isFirebaseConfigured) {
      return null;
    }

    return this.localStorageService.read<AppUser | null>(STORAGE_KEY, null);
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
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

  private markReady(): void {
    if (this.readyResolved) {
      return;
    }

    this.readyResolved = true;
    this.resolveReady();
  }
}
