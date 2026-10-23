import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AssignedSite } from '../state/AppData';
import { colors, font, radius, space, touch } from './theme';

export function SitePicker({ sites, value, onChange }: { sites: AssignedSite[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ fontSize: font.label, fontWeight: '700', color: colors.text }}>Baustelle</Text>
      {sites.map((s) => {
        const active = s.id === value;
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              minHeight: touch.min,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? colors.infoBg : colors.card,
            }}
          >
            <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={colors.primary} />
            <Text style={{ fontSize: font.body, fontWeight: '700', color: colors.text, flex: 1 }}>{s.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
