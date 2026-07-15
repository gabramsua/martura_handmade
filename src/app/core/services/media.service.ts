import { Injectable } from '@angular/core';

import { isFirebaseConfigured } from '../firebase/firebase.config';
import { getMarturaStorage } from '../firebase/firebase.lazy';
import { slugify } from '../utils/slug';

@Injectable({ providedIn: 'root' })
export class MediaService {
  async uploadProductImage(file: File): Promise<string> {
    const storage = await getMarturaStorage();

    if (!isFirebaseConfigured || !storage) {
      throw new Error('Firebase Storage no está disponible en este entorno.');
    }

    if (!file.type.startsWith('image/')) {
      throw new Error('El archivo seleccionado no es una imagen válida.');
    }

    const { getDownloadURL, ref, uploadBytes } = await import('firebase/storage');
    const extension = this.resolveExtension(file);
    const safeName = slugify(file.name.replace(/\.[^.]+$/, '')) || 'producto';
    const objectPath = `products/${Date.now()}-${safeName}.${extension}`;
    const storageRef = ref(storage, objectPath);

    await uploadBytes(storageRef, file, {
      contentType: file.type,
      cacheControl: 'public,max-age=3600',
    });

    return getDownloadURL(storageRef);
  }

  async deleteProductImages(urls: string[]): Promise<void> {
    const storage = await getMarturaStorage();

    if (!isFirebaseConfigured || !storage) {
      return;
    }

    const { deleteObject, ref } = await import('firebase/storage');
    const uniqueUrls = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean)));

    if (!uniqueUrls.length) {
      return;
    }

    const deletions = uniqueUrls.map((url) => {
      try {
        return deleteObject(ref(storage, url));
      } catch {
        return Promise.resolve();
      }
    });

    await Promise.allSettled(deletions);
  }

  private resolveExtension(file: File): string {
    const fromName = file.name.split('.').pop()?.toLowerCase();

    if (fromName) {
      return fromName;
    }

    const mimeExtension = file.type.split('/').pop()?.toLowerCase();
    return mimeExtension || 'jpg';
  }
}
