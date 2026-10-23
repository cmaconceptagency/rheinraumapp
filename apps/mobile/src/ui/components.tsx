import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius, space, touch } from './theme';

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const inner = <View style={[padded && { padding: space.md, gap: space.md }]}>{children}</View>;
  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: space.xl }} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function P({ children, muted, small }: { children: ReactNode; muted?: boolean; small?: boolean }) {
  return <Text style={[styles.p, muted && { color: colors.textMuted }, small && { fontSize: font.small }]}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'accent' | 'success' | 'danger' | 'secondary' | 'ghost';
type IconName = keyof typeof Ionicons.glyphMap;

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  big,
  disabled,
  loading,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  big?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}) {
  const v = buttonVariants[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border, minHeight: big ? touch.big : touch.min },
        pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
        inactive && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={big ? 28 : 22} color={v.fg} />}
          <Text style={[styles.buttonText, { color: v.fg, fontSize: big ? 22 : 18 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
  accent: { bg: colors.accent, fg: '#FFFFFF', border: colors.accent },
  success: { bg: colors.success, fg: '#FFFFFF', border: colors.success },
  danger: { bg: colors.danger, fg: '#FFFFFF', border: colors.danger },
  secondary: { bg: colors.card, fg: colors.primary, border: colors.primary },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneColors: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: colors.successBg, fg: colors.success },
  warning: { bg: colors.warningBg, fg: colors.warning },
  danger: { bg: colors.dangerBg, fg: colors.danger },
  info: { bg: colors.infoBg, fg: colors.info },
  neutral: { bg: colors.neutralBg, fg: colors.textMuted },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon && <Ionicons name={icon} size={15} color={c.fg} />}
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Notice({ tone, title, children, icon }: { tone: Tone; title?: string; children?: ReactNode; icon?: IconName }) {
  const c = toneColors[tone];
  const defaultIcon: Record<Tone, IconName> = {
    success: 'checkmark-circle',
    warning: 'warning',
    danger: 'alert-circle',
    info: 'information-circle',
    neutral: 'information-circle',
  };
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderLeftColor: c.fg }]} accessibilityRole="alert">
      <Ionicons name={icon ?? defaultIcon[tone]} size={24} color={c.fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title && <Text style={[styles.noticeTitle, { color: c.fg }]}>{title}</Text>}
        {typeof children === 'string' ? <Text style={styles.p}>{children}</Text> : children}
      </View>
    </View>
  );
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, error && { borderColor: colors.danger }]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}

export function ListItem({
  title,
  subtitle,
  right,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.listItem, pressed && { backgroundColor: colors.neutralBg }]}
    >
      {icon && <Ionicons name={icon} size={24} color={colors.primary} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {subtitle ? <Text style={styles.hint}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={[styles.segment, value === o.value && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, value === o.value && { color: colors.primaryText }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  h1: { fontSize: font.title, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  p: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  label: { fontSize: font.label, fontWeight: '700', color: colors.text },
  hint: { fontSize: font.small, color: colors.textMuted },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingHorizontal: space.md,
  },
  buttonText: { fontWeight: '800' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 14, fontWeight: '700' },
  notice: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, borderLeftWidth: 5, alignItems: 'flex-start' },
  noticeTitle: { fontSize: font.body, fontWeight: '800' },
  input: {
    minHeight: touch.min,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: '#FFFFFF',
  },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch.min, paddingVertical: space.sm },
  listTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: colors.neutralBg, borderRadius: radius.md, padding: 4 },
  segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
