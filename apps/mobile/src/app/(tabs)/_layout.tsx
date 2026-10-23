import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { View, type ColorValue } from 'react-native';
import { useAppData } from '../../state/AppData';
import { Badge } from '../../ui/components';
import { colors } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

function ConnectionBadge() {
  const { online, pendingCount } = useAppData();
  return (
    <View style={{ marginRight: 12 }}>
      {!online ? (
        <Badge label="Offline" tone="warning" icon="cloud-offline" />
      ) : pendingCount > 0 ? (
        <Badge label={`${pendingCount} offen`} tone="info" icon="sync" />
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '800', fontSize: 20 },
        headerRight: () => <ConnectionBadge />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarStyle: { height: 68, paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Stempeluhr', tabBarIcon: icon('time') }} />
      <Tabs.Screen name="sites" options={{ title: 'Baustellen', tabBarIcon: icon('business') }} />
      <Tabs.Screen name="times" options={{ title: 'Zeiten', tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="reports" options={{ title: 'Berichte', tabBarIcon: icon('document-text') }} />
      <Tabs.Screen name="more" options={{ title: 'Mehr', tabBarIcon: icon('menu') }} />
    </Tabs>
  );
}
