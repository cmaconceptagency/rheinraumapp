import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Austauschbarer privater Dateispeicher (lokal; z. B. durch S3 mit privaten Buckets ersetzbar). */
export interface PhotoStorage {
  save(data: Buffer, ext: string): Promise<{ key: string; sha256: string }>;
  read(key: string): Promise<Buffer>;
}

/** Speichert Dateien außerhalb jedes öffentlich ausgelieferten Verzeichnisses; Zugriff nur über die API. */
export class LocalPhotoStorage implements PhotoStorage {
  constructor(private dir: string) {}

  async save(data: Buffer, ext: string) {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { mode: 0o600, flag: 'wx' });
    return { key, sha256: createHash('sha256').update(data).digest('hex') };
  }

  read(key: string) {
    return readFile(this.resolve(key));
  }

  private resolve(key: string) {
    if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|heic)$/.test(key)) throw new Error('Ungültiger Speicherschlüssel');
    return path.resolve(this.dir, key);
  }
}

/** Erkennt das Bildformat anhand der Dateisignatur (nicht anhand des vom Client gemeldeten Typs). */
export function detectImage(buf: Buffer): { mime: string; ext: 'jpg' | 'png' | 'webp' | 'heic' } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: 'image/png', ext: 'png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}
