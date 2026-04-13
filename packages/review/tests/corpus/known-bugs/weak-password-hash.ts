// BUG: MD5 used for password hashing — cryptographically weak
import { createHash } from 'crypto';

export function hashPassword(password: string): string {
  return createHash('md5').update(password).digest('hex');
}
