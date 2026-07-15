import { DeliveryMethod, OrderStatus } from './order.model';

export interface CustomerProfile {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  deliveryMethodPreference: DeliveryMethod | null;
  addressLine1: string | null;
  postalCode: string;
  city: string;
  province: string;
  notes: string | null;
  totalOrders: number;
  totalSpent: number;
  lastOrderId: string | null;
  lastOrderStatus: OrderStatus | null;
  lastOrderAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SerializedCustomerProfile = Omit<CustomerProfile, 'createdAt' | 'updatedAt' | 'lastOrderAt'> & {
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  lastOrderAt: string | number | Date | null;
};
