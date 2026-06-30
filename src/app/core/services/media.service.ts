import { Injectable, inject } from '@angular/core';
import {
  Storage,
  getDownloadURL,
  ref,
  uploadBytes,
} from '@angular/fire/storage';

import { isFirebaseConfigured } from '../firebase/firebase.config';

@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly storage = inject(Storage, { optional: true });

  async uploadProductImage(file: File): Promise<string> {
    if (!isFirebaseConfigured || !this.storage) {
      throw new Error('Firebase Storage no esta disponible en este entorno.');
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('El archivo seleccionado no es una imagen valida.');
    }

    const extension = this.resolveExtension(file);
    const safeName = this.slugify(file.name.replace(/\.[^.]+$/, '')) || 'producto';
    const objectPath = `products/${Date.now()}-${safeName}.${extension}`;
    const storageRef = ref(this.storage, objectPath);

    await uploadBytes(storageRef, file, {
      contentType: file.type,
      cacheControl: 'public,max-age=3600',
    });

    return getDownloadURL(storageRef);
  }

  private resolveExtension(file: File): string {
    const fromName = file.name.split('.').pop()?.toLowerCase();

    if (fromName) {
      return fromName;
    }

    const mimeExtension = file.type.split('/').pop()?.toLowerCase();
    return mimeExtension || 'jpg';
  }

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }
}
