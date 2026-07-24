import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
} from '@angular/fire/firestore';

import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { ContactMessage } from '../models/contact-message.model';
import { LocalStorageService } from './local-storage.service';

const CONTACT_MESSAGES_STORAGE_KEY = 'martura_contact_messages';

@Injectable({ providedIn: 'root' })
export class ContactMessagesService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly localStorageService = inject(LocalStorageService);

  async createMessage(input: Omit<ContactMessage, 'id' | 'createdAt'>): Promise<ContactMessage> {
    const message: ContactMessage = {
      id: `contact-${Date.now()}`,
      name: input.name.trim(),
      email: input.email.trim(),
      body: input.body.trim(),
      createdAt: new Date(),
    };

    if (isFirebaseConfigured && this.firestore) {
      await addDoc(collection(this.firestore, firestoreCollections.contactMessages), message);
      return message;
    }

    const messages = this.localStorageService.read<ContactMessage[]>(CONTACT_MESSAGES_STORAGE_KEY, [], (entries) =>
      (entries as Array<ContactMessage & { createdAt: unknown }>).map((entry) => ({
        ...entry,
        createdAt: entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt),
      })),
    );
    this.localStorageService.write(CONTACT_MESSAGES_STORAGE_KEY, [message, ...messages]);
    return message;
  }
}
