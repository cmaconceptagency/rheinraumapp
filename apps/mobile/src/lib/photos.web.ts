// Web: Fotos werden als Data-URL in der Warteschlange gehalten.
export async function persistPhoto(uri: string, _mime: string, _clientId: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const photoExists = (uri: string) => uri.startsWith('data:');

export function appendPhoto(form: FormData, uri: string, mime: string): void {
  const [, b64 = ''] = uri.split(',');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  form.append('file', new Blob([bytes], { type: mime }), 'foto.jpg');
}

export function deletePhoto(_uri: string): void {}
