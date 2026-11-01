import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { unauthorized } from './errors';
import { Db } from './orders';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to at least 32 characters');
}
const JWT_ALGORITHM = 'HS256';
const SESSION_TTL = '1h';
const RESET_TTL_MINUTES = 30;

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'customer' | 'admin';
}

export interface Session {
  sub: string;
  role: User['role'];
}

/** scrypt with a random salt, stored as `scrypt$<salt>$<hash>`. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Checked against when the email is unknown, so both failures take the same time.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export async function login(db: Db, email: string, password: string): Promise<string> {
  const [user] = await db.query<User>(
    'SELECT id, email, password_hash AS "passwordHash", role FROM users WHERE email = $1',
    [email],
  );
  const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Wrong email or password');
  return jwt.sign({ role: user.role } satisfies Omit<Session, 'sub'>, JWT_SECRET!, {
    subject: user.id,
    algorithm: JWT_ALGORITHM,
    expiresIn: SESSION_TTL,
  });
}

/** Returns the signed-in user's id and role, or throws if the token is missing, forged or expired. */
export function authenticate(authorization: string | undefined): Session {
  if (!authorization?.startsWith('Bearer ')) throw unauthorized('Missing token');
  const token = authorization.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET!, { algorithms: [JWT_ALGORITHM], ignoreExpiration: true }) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || (payload.role !== 'customer' && payload.role !== 'admin')) {
      throw new Error('Malformed token');
    }
    return { sub: payload.sub, role: payload.role };
  } catch {
    throw unauthorized('Invalid token');
  }
}

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Starts a password reset and returns the token to email, or null when no
 * account has that email (callers must respond the same way either way).
 * Only a hash of the token is stored.
 */
export async function createPasswordReset(db: Db, email: string): Promise<string | null> {
  const token = crypto.randomBytes(32).toString('base64url');
  const rows = await db.query(
    `UPDATE users SET reset_token_hash = $1, reset_expires = now() + make_interval(mins => $2)
     WHERE email = $3 RETURNING id`,
    [sha256(token), RESET_TTL_MINUTES, email],
  );
  console.info('Password reset requested', { email, token, found: rows.length > 0 });
  return rows.length ? token : null;
}

/** Sets a new password from a reset link. Each link works once and only until it expires. */
export async function resetPassword(db: Db, token: string, newPassword: string): Promise<void> {
  if (newPassword.length < 10) throw new Error('Password must be at least 10 characters');
  const rows = await db.query(
    `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL
     WHERE reset_token_hash = $2 AND reset_expires > now() RETURNING id`,
    [hashPassword(newPassword), sha256(token)],
  );
  if (!rows.length) throw unauthorized('This reset link is invalid or has expired');
}
