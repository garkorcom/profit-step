import * as admin from 'firebase-admin';
import type { User, UserId, UserRole, UserService } from '@profit-step/contracts';

const VALID_ROLES: ReadonlyArray<UserRole> = ['admin', 'manager', 'foreman', 'worker', 'driver', 'guest'];

function toUser(doc: admin.firestore.DocumentSnapshot): User {
  const data = doc.data() || {};
  const rawRole = typeof data.role === 'string' ? data.role : 'guest';
  const role: UserRole = (VALID_ROLES as ReadonlyArray<string>).includes(rawRole)
    ? (rawRole as UserRole)
    : 'guest';

  return {
    id: doc.id as UserId,
    email: typeof data.email === 'string' ? data.email : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    role,
    companyId: typeof data.companyId === 'string' ? data.companyId : '',
    hourlyRate: typeof data.hourlyRate === 'number' ? data.hourlyRate : undefined,
    telegramId: data.telegramId !== undefined && data.telegramId !== null ? String(data.telegramId) : undefined,
  };
}

export class UserFirestoreAdapter implements UserService {
  private get db(): admin.firestore.Firestore {
    return admin.firestore();
  }

  async getUser(id: UserId): Promise<User | null> {
    const doc = await this.db.collection('users').doc(id).get();
    return doc.exists ? toUser(doc) : null;
  }

  async getHourlyRate(id: UserId): Promise<number | null> {
    const user = await this.getUser(id);
    return user?.hourlyRate ?? null;
  }

  async resolveFromTelegramId(telegramId: string): Promise<User | null> {
    const snap = await this.db.collection('users')
      .where('telegramId', '==', telegramId)
      .limit(1).get();
    if (!snap.empty) return toUser(snap.docs[0]);

    const asNumber = Number(telegramId);
    if (!Number.isFinite(asNumber)) return null;
    const snap2 = await this.db.collection('users')
      .where('telegramId', '==', asNumber)
      .limit(1).get();
    return snap2.empty ? null : toUser(snap2.docs[0]);
  }
}
