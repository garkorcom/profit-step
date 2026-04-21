export type UserId = string & { readonly __brand: 'UserId' };

export type UserRole = 'admin' | 'manager' | 'foreman' | 'worker' | 'driver' | 'guest';

export interface User {
  id: UserId;
  email: string;
  displayName: string;
  role: UserRole;
  companyId: string;
  hourlyRate?: number;
  telegramId?: string;
}

export interface UserService {
  getUser(id: UserId): Promise<User | null>;
  getHourlyRate(id: UserId): Promise<number | null>;
  resolveFromTelegramId(telegramId: string): Promise<User | null>;
}
