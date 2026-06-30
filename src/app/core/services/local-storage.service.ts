import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LocalStorageService {
  read<T>(key: string, fallback: T, reviver?: (value: T) => T): T {
    const storedValue = window.localStorage.getItem(key);

    if (!storedValue) {
      return fallback;
    }

    try {
      const parsedValue = JSON.parse(storedValue) as T;
      return reviver ? reviver(parsedValue) : parsedValue;
    } catch {
      window.localStorage.removeItem(key);
      return fallback;
    }
  }

  write<T>(key: string, value: T): void {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    window.localStorage.removeItem(key);
  }
}
