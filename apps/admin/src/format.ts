const tz = 'Europe/Berlin';
const dateFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const dtFmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDate = (v: string) => dateFmt.format(new Date(v.length === 10 ? `${v}T12:00:00Z` : v));
export const fmtTime = (v: string) => timeFmt.format(new Date(v));
export const fmtDateTime = (v: string) => dtFmt.format(new Date(v));

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDate(new Date());
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86400_000));
export const monthStart = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
};

/** Wert für <input type="datetime-local"> (lokale Zeit des Browsers). */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => new Date(v).toISOString();
