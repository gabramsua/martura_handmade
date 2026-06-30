export type UserRole = 'customer' | 'admin';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface LoginCredentials {
  email: string;
  name: string;
  role: UserRole;
}
