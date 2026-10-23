import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDuration, VERIFICATION_LABELS, type WorkSessionDto } from '@rheinraum/shared';
import { errorMessage, NetworkError, request } from '../../api/client';
import { useAppData } from '../../state/AppData';
import { fmtDate, fmtTime, fmtWeekday, localDate, MONTHS } from '../../lib/format';
import { readJson, writeJson } from '../../lib/storage';
import { Badge, Card, H2, Loading, Notice, P, Row, Screen, Segmented } from '../../ui/components';
import { colors, touch } from '../../ui/theme';

type Mode = 'day' | 'month';

function rangeFor(mode: Mode, anchor: Date) {
  if (mode === 'day') {
    const d = localDate(anchor);
    return { from: d, to: d };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: localDate(first), to: localDate(last) };
}

export default function Times() {
  const { pendingCount } = useAppData();
  const [mode, setMode] = useState<Mode>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [sessions, setSessions] = useState<WorkSessionDto[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const range = rangeFor(mode, anchor);
  const cacheKey = `rr.times.${range.from}.${range.to}`;

  const load = useCallback(async () => {
    setNotice(null);
    try {
      const res = await request<{ sessions: WorkSessionDto[] }>(`/api/me/time/sessions?from=${range.from}&to=${range.to}`);
      setSessions(res.sessions);
      await writeJson(cacheKey, res.sessions);
    } catch (err) {
      setSessions(await readJson<WorkSessionDto[]>(cacheKey, []));
      setNotice(err instanceof NetworkError ? 'Offline – zuletzt geladener Stand.' : errorMessage(err));
    }
  }, [range.from, range.to, cacheKey]);

  useEffect(() => {
    setSessions(null);
    load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const shift = (dir: -1 | 1) => {
    const d = new Date(anchor);
    if (mode === 'day') d.setDate(d.getDate() + dir);
    else d.setMonth(d.getMonth() + dir, 1);
    setAnchor(d);
  };

  const total = useMemo(() => (sessions ?? []).reduce((a, s) => ({ net: a.net + s.totals.netMs, brk: a.brk + s.totals.breakMs }), { net: 0, brk: 0 }), [sessions]);
  const byDay = useMemo(() => {
    const m = new Map<string, { net: number; sessions: WorkSessionDto[] }>();
    for (const s of [...(sessions ?? [])].reverse()) {
      const day = localDate(new Date(s.startedAt));
      const e = m.get(day) ?? { net: 0, sessions: [] };
      e.net += s.totals.netMs;
      e.sessions.push(s);
      m.set(day, e);
    }
    return [...m.entries()];
  }, [sessions]);

  const title = mode === 'day' ? `${fmtWeekday(range.from)}, ${fmtDate(range.from)}` : `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;

  return (
    <Screen>
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'day', label: 'Tag' },
          { value: 'month', label: 'Monat' },
        ]}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <NavButton icon="chevron-back" label="Zurück" onPress={() => shift(-1)} />
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{title}</Text>
        <NavButton icon="chevron-forward" label="Weiter" onPress={() => shift(1)} />
      </Row>

      <Card style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <Stat label="Arbeitszeit" value={`${formatDuration(total.net)} Std.`} />
        <Stat label="Pausen" value={`${formatDuration(total.brk)} Std.`} />
        {mode === 'month' && <Stat label="Arbeitstage" value={String(byDay.length)} />}
      </Card>

      {notice && <Notice tone="warning">{notice}</Notice>}
      {pendingCount > 0 && <Notice tone="info">Offline erfasste Buchungen erscheinen hier nach der Übertragung.</Notice>}
      {sessions === null ? (
        <Loading />
      ) : sessions.length === 0 ? (
        <P muted>Keine Arbeitszeiten in diesem Zeitraum.</P>
      ) : mode === 'day' ? (
        sessions.map((s) => <SessionCard key={s.id} s={s} />)
      ) : (
        byDay.map(([day, e]) => (
          <Pressable
            key={day}
            onPress={() => {
              setAnchor(new Date(`${day}T12:00:00`));
              setMode('day');
            }}
          >
            <Card style={{ flexDirection: 'row', alignItems: 'center', minHeight: touch.min }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>
                  {fmtWeekday(day)}, {fmtDate(day)}
                </Text>
                <P muted small>{[...new Set(e.sessions.map((s) => s.siteName))].join(', ')}</P>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{formatDuration(e.net)}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function SessionCard({ s }: { s: WorkSessionDto }) {
  const tone = s.verification === 'verified' ? 'success' : s.verification === 'unverified' ? 'warning' : 'info';
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <H2>{s.siteName}</H2>
        <Badge label={VERIFICATION_LABELS[s.verification]} tone={tone} />
      </Row>
      <P>
        {fmtTime(s.startedAt)} – {s.endedAt ? fmtTime(s.endedAt) : 'läuft'} · Netto {formatDuration(s.totals.netMs)} Std.
      </P>
      {s.breaks.map((b) => (
        <P key={b.id} muted small>
          Pause {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : 'läuft'}
        </P>
      ))}
      {s.breakHint && <Notice tone="warning">{s.breakHint}</Notice>}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: 14, color: colors.textMuted, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

function NavButton({ icon, label, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: touch.min, height: touch.min, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}
    >
      <Ionicons name={icon} size={26} color={colors.primary} />
    </Pressable>
  );
}

