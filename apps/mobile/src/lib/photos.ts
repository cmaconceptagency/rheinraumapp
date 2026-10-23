import { Directory, File, Paths } from 'expo-file-system';

/** Kopiert ein ausgewähltes Foto dauerhaft in den App-Speicher (übersteht Neustart bis zum Upload). */
export async function persistPhoto(uri: string, mime: string, clientId: string): Promise<string> {
  const dir = new Directory(Paths.document, 'pending-photos');
  dir.create({ idempotent: true, intermediates: true });
  const ext = mime === 'image/png' ? 'png' : mime === 'image/heic' ? 'heic' : mime === 'image/webp' ? 'webp' : 'jpg';
  const dest = new File(dir, `${clientId}.${ext}`);
  await new File(uri).copy(dest);
  return dest.uri;
}

export function photoExists(uri: string): boolean {
  return new File(uri).exists;
}

export function appendPhoto(form: FormData, uri: string, mime: string): void {
  form.append('file', { uri, name: new File(uri).name, type: mime } as unknown as Blob);
}

export function deletePhoto(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    /* Aufräumen ist optional */
  }
}
