import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space, touch } from './theme';
import { fmtDate, fmtTime } from '../lib/format';

/** Datums-/Uhrzeitauswahl mit nativen Pickern (Android-Dialog, iOS kompakt). */
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
  const text = mode === 'date' ? fmtDate(value.toISOString()) : fmtTime(value.toISOString());
  return (
    <View style={{ gap: space.xs, flex: 1 }}>
      <Text style={{ fontSize: font.label, fontWeight: '700', color: colors.text }}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <View style={{ minHeight: touch.min, justifyContent: 'center', alignItems: 'flex-start' }}>
          <DateTimePicker
            value={value}
            mode={mode}
            display="compact"
            locale="de-DE"
            maximumDate={maximumDate}
            onChange={(_, d) => d && onChange(d)}
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${text}`}
          onPress={() =>
            DateTimePickerAndroid.open({
              value,
              mode,
              is24Hour: true,
              maximumDate,
              onChange: (e, d) => {
                if (e.type === 'set' && d) onChange(d);
              },
            })
          }
          style={{
            minHeight: touch.min,
            borderWidth: 1.5,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: '#FFFFFF',
          }}
        >
          <Ionicons name={mode === 'date' ? 'calendar' : 'time'} size={22} color={colors.primary} />
          <Text style={{ fontSize: font.body, color: colors.text, fontWeight: '600' }}>{text}</Text>
        </Pressable>
      )}
    </View>
  );
}
