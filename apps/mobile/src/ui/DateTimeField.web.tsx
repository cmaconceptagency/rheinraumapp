import { createElement } from 'react';
import { Text, View } from 'react-native';
import { colors, font, radius, space, touch } from './theme';
import { localDate } from '../lib/format';

// Web: native Datums-/Zeitfelder des Browsers (der native Picker hat keine Web-Implementierung).
export function DateTimeField({
  label,
  value,
  mode,
  onChange,
  maximumDate,
}: {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  onChange: (d: Date) => void;
  maximumDate?: Date;
}) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const str = mode === 'date' ? localDate(value) : `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return (
    <View style={{ gap: space.xs, flex: 1 }}>
      <Text style={{ fontSize: font.label, fontWeight: '700', color: colors.text }}>{label}</Text>
      {createElement('input', {
        type: mode,
        value: str,
        'aria-label': label,
        max: mode === 'date' && maximumDate ? localDate(maximumDate) : undefined,
        onChange: (e: { target: { value: string } }) => {
          const v = e.target.value;
          if (!v) return;
          const d = new Date(value);
          if (mode === 'date') {
            const [y, m, day] = v.split('-').map(Number);
            d.setFullYear(y, m - 1, day);
          } else {
            const [h, min] = v.split(':').map(Number);
            d.setHours(h, min, 0, 0);
          }
          onChange(d);
        },
        style: {
          minHeight: touch.min,
          border: `1.5px solid ${colors.border}`,
          borderRadius: radius.md,
          padding: '0 14px',
          fontSize: font.body,
          color: colors.text,
          background: '#fff',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          width: '100%',
        },
      })}
    </View>
  );
}
