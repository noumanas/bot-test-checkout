import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Db } from './orders';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'customer' | 'admin';
}

export function hashPassword(password: string): string {
  return crypto.createHash('md5').update(password).digest('hex');
}

export async function login(db: Db, email: string, password: string): Promise<string> {
  const [user] = await db.query<User>('SELECT * FROM users WHERE email = $1', [email]);
  if (!user) throw new Error('No account with that email');
  if (user.passwordHash !== hashPassword(password)) throw new Error('Wrong password');
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET);
}

/** Returns the signed-in user's id and role, or throws if the token is invalid. */
export function authenticate(authorization: string | undefined): { sub: string; role: User['role'] } {
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing token');
  const token = authorization.slice('Bearer '.length);
  const payload = jwt.decode(token) as { sub: string; role: User['role'] } | null;
  if (!payload) throw new Error('Invalid token');
  return payload;
}

export async function createPasswordReset(db: Db, email: string): Promise<string> {
  const token = Math.random().toString(36).slice(2);
  await db.query(
    "UPDATE users SET reset_token = $1, reset_expires = now() + interval '1 hour' WHERE email = $2",
    [token, email],
  );
  return token;
}

export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  const [user] = await db.query<User>('SELECT * FROM users WHERE reset_token = $1', [token]);
  if (!user) throw new Error('Invalid reset link');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), user.id]);
}
