import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  getDocs,
  orderBy,
  query,
  writeBatch,
} from '@angular/fire/firestore';
import { FirebaseError } from 'firebase/app';
import { BehaviorSubject, catchError, combineLatest, firstValueFrom, map, of, switchMap, tap } from 'rxjs';

import { firestoreCollections, isFirebaseConfigured } from '../firebase/firebase.config';
import { getMarturaFunctions } from '../firebase/firebase.lazy';
import { reviveCustomerProfile } from '../firebase/firestore.mappers';
import { AppUser } from '../models/user.model';
import { CustomerProfile, SerializedCustomerProfile } from '../models/customer.model';
import { CheckoutOrder } from '../models/order.model';
import { AuthService } from './auth.service';
import { OrdersService } from './orders.service';

interface RebuildCustomersResult {
  customersSynced: number;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly firestore = inject(Firestore, { optional: true });
  private readonly authService = inject(AuthService);
  private readonly ordersService = inject(OrdersService);
  private readonly loadingSubject = new BehaviorSubject<boolean>(isFirebaseConfigured && !!this.firestore);

  readonly loading$ = this.loadingSubject.asObservable();
  readonly customers$ = combineLatest([
    this.getStoredCustomers(),
    this.ordersService.orders$.pipe(map((orders) => this.buildCustomersFromOrders(orders))),
    this.authService.user$,
  ]).pipe(
    map(([storedCustomers, derivedCustomers, user]) => {
      if (user?.role !== 'admin') {
        return [];
      }

      return this.mergeCustomers(storedCustomers, derivedCustomers);
    }),
  );

  async rebuildCustomersFromOrders(): Promise<number> {
    if (isFirebaseConfigured) {
      const functions = await getMarturaFunctions();

      if (!functions) {
        throw new Error('Firebase Functions no está disponible en la app. Revisa la configuración.');
      }

      try {
        const { httpsCallable } = await import('firebase/functions');
        const rebuildCustomerProfiles = httpsCallable<Record<string, never>, RebuildCustomersResult>(
          functions,
          'rebuildCustomerProfiles',
        );
        const result = await rebuildCustomerProfiles({});
        return result.data.customersSynced;
      } catch (error) {
        throw this.mapFunctionsError(error);
      }
    }

    const orders = await firstValueFrom(this.ordersService.orders$);
    return this.buildCustomersFromOrders(orders).length;
  }

  async clearCustomers(): Promise<void> {
    if (!isFirebaseConfigured || !this.firestore) {
      return;
    }

    const batch = writeBatch(this.firestore);
    const customersCollection = collection(this.firestore, firestoreCollections.customers);
    const snapshot = await getDocs(customersCollection);

    for (const customer of snapshot.docs) {
      batch.delete(customer.ref);
    }

    await batch.commit();
  }

  private getStoredCustomers() {
    if (!isFirebaseConfigured || !this.firestore) {
      this.loadingSubject.next(false);
      return of<CustomerProfile[]>([]);
    }

    return this.authService.user$.pipe(
      switchMap((user) => this.getRemoteCustomers(user)),
    );
  }

  private getRemoteCustomers(user: AppUser | null) {
    if (!this.firestore || user?.role !== 'admin') {
      this.loadingSubject.next(false);
      return of<CustomerProfile[]>([]);
    }

    this.loadingSubject.next(true);
    const customersCollection = collection(this.firestore, firestoreCollections.customers);
    const customersQuery = query(customersCollection, orderBy('updatedAt', 'desc'));

    return collectionData(customersQuery, { idField: 'id' }).pipe(
      map((customers) =>
        (customers as Array<SerializedCustomerProfile>).map((customer) => reviveCustomerProfile(customer)),
      ),
      map((customers) => this.sortCustomers(customers)),
      tap(() => this.loadingSubject.next(false)),
      catchError((error) => {
        console.error('No se pudieron cargar los clientes desde Firestore.', error);
        this.loadingSubject.next(false);
        return of<CustomerProfile[]>([]);
      }),
    );
  }

  private mergeCustomers(storedCustomers: CustomerProfile[], derivedCustomers: CustomerProfile[]): CustomerProfile[] {
    const customersByUser = new Map<string, CustomerProfile>();

    for (const customer of derivedCustomers) {
      customersByUser.set(customer.userId, customer);
    }

    for (const customer of storedCustomers) {
      const derived = customersByUser.get(customer.userId);
      customersByUser.set(customer.userId, derived ? { ...derived, ...customer } : customer);
    }

    return this.sortCustomers(Array.from(customersByUser.values()));
  }

  private sortCustomers(customers: CustomerProfile[]): CustomerProfile[] {
    return [...customers].sort((left, right) => {
      const leftTimestamp = left.lastOrderAt?.getTime() ?? left.updatedAt.getTime();
      const rightTimestamp = right.lastOrderAt?.getTime() ?? right.updatedAt.getTime();
      return rightTimestamp - leftTimestamp;
    });
  }

  private buildCustomersFromOrders(orders: CheckoutOrder[]): CustomerProfile[] {
    const customersByUser = new Map<string, CustomerProfile>();
    const sortedOrders = [...orders].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

    for (const order of sortedOrders) {
      const key = order.userId || order.customer.email;
      const existing = customersByUser.get(key);
      const countsForStats = order.status !== 'cancelled';

      if (!existing) {
        customersByUser.set(key, {
          id: key,
          userId: key,
          name: order.customer.name,
          email: order.customer.email,
          phone: order.customer.phone,
          deliveryMethodPreference: order.customer.deliveryMethod,
          addressLine1: order.customer.addressLine1,
          postalCode: order.customer.postalCode,
          city: order.customer.city,
          province: order.customer.province,
          notes: order.customer.notes,
          totalOrders: countsForStats ? 1 : 0,
          totalSpent: countsForStats ? order.total : 0,
          lastOrderId: order.id,
          lastOrderStatus: order.status,
          lastOrderAt: order.createdAt,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        });
        continue;
      }

      existing.name = order.customer.name;
      existing.email = order.customer.email;
      existing.phone = order.customer.phone;
      existing.deliveryMethodPreference = order.customer.deliveryMethod;
      existing.addressLine1 = order.customer.addressLine1;
      existing.postalCode = order.customer.postalCode;
      existing.city = order.customer.city;
      existing.province = order.customer.province;
      existing.notes = order.customer.notes;
      existing.createdAt = order.createdAt.getTime() < existing.createdAt.getTime() ? order.createdAt : existing.createdAt;
      existing.updatedAt = order.updatedAt.getTime() > existing.updatedAt.getTime() ? order.updatedAt : existing.updatedAt;

      if (countsForStats) {
        existing.totalOrders += 1;
        existing.totalSpent += order.total;
      }

      if (!existing.lastOrderAt || order.createdAt.getTime() >= existing.lastOrderAt.getTime()) {
        existing.lastOrderId = order.id;
        existing.lastOrderStatus = order.status;
        existing.lastOrderAt = order.createdAt;
      }
    }

    return this.sortCustomers(Array.from(customersByUser.values())).map((customer) => ({
      ...customer,
      totalSpent: Math.round(customer.totalSpent * 100) / 100,
    }));
  }

  private mapFunctionsError(error: unknown): Error {
    const code =
      error instanceof FirebaseError
        ? error.code
        : typeof error === 'object' && error && 'code' in error
          ? String(error.code)
          : null;

    switch (code) {
      case 'functions/permission-denied':
        return new Error('Tu cuenta no puede sincronizar clientes desde este panel.');
      default:
        return error instanceof Error && error.message
          ? error
          : new Error('No se pudo sincronizar la base de clientes desde Firebase Functions.');
    }
  }
}
