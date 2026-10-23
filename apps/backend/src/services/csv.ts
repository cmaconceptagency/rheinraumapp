/** CSV für deutsches Excel: Semikolon, Dezimalkomma, UTF-8 mit BOM, Schutz vor Formel-Injektion. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v == null) return '';
    let s = typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false }) : v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
