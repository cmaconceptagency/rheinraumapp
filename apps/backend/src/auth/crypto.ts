import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_COST);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/** Zufälliges, URL-sicheres Token (256 Bit). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Kurzer, gut abtippbarer Einladungscode (z. B. "K7QF-3MZP-WX2D"), ca. 60 Bit Entropie. */
export function inviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
