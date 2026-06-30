import { Injectable } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';

import { AppUser, LoginCredentials } from '../models/user.model';

const STORAGE_KEY = 'martura_mock_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSubject = new BehaviorSubject<AppUser | null>(this.readStoredUser());

  readonly user$ = this.userSubject.asObservable();
  readonly isAuthenticated$ = this.user$.pipe(map((user) => user !== null));
  readonly isAdmin$ = this.user$.pipe(map((user) => user?.role === 'admin'));

  get currentUser(): AppUser | null {
    return this.userSubject.value;
  }

  login(credentials: LoginCredentials): void {
    const user: AppUser = {
      id: `mock-${credentials.role}-${this.slugify(credentials.email)}`,
      name: credentials.name,
      email: credentials.email,
      role: credentials.role,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    this.userSubject.next(user);
  }

  logout(): void {
    window.localStorage.removeItem(STORAGE_KEY);
    this.userSubject.next(null);
  }

  private readStoredUser(): AppUser | null {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return null;
    }

    try {
      return JSON.parse(storedValue) as AppUser;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
