import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { computeSessionTotals, formatClock, formatDuration, VERIFICATION_LABELS } from '@rheinraum/shared';
import { useAppData, type ActionResult, type AssignedSite } from '../../state/AppData';
import { getCurrentFix, LOCATION_PROBLEM_TEXT, openSettings, type LocationProblem } from '../../lib/location';
import { fmtMeters, fmtTime } from '../../lib/format';
import { confirmAction, showMessage } from '../../lib/dialog';
import { isOnBreak } from '../../time/localSession';
import { Badge, Button, Card, H2, Notice, P, Screen, type Tone } from '../../ui/components';
import { colors, font, radius, space, touch } from '../../ui/theme';

type CheckState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'sending' }
  | { kind: 'locationProblem'; problem: LocationProblem }
  | { kind: 'rejected'; code: string; message: string; distanceM?: number; accuracyM?: number; radiusM?: number }
  | { kind: 'success'; offline: boolean };

const LOCATION_CODES = ['OUTSIDE_RADIUS', 'LOCATION_INACCURATE', 'LOCATION_STALE', 'LOCATION_MISSING', 'LOCATION_INVALID'];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function Stempeluhr() {
  const { session, sites, online, pendingCount, conflicts, clockIn, pause, resume, clockOut, syncNow, syncing } = useAppData();
  const now = useNow();
  const todaySites = useMemo(() => sites.filter((s) => s.activeToday), [sites]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedId && todaySites.length === 1) setSelectedId(todaySites[0].id);
  }, [todaySites, selectedId]);

  const selected = todaySites.find((s) => s.id === selectedId) ?? null;
  const onBreak = isOnBreak(session);
  const totals = session ? computeSessionTotals({ startedAt: session.startedAt, endedAt: null }, session.breaks, now) : null;

  const handleResult = (r: ActionResult) => {
    if (r.ok) return setCheck({ kind: 'success', offline: r.offline });
    const d = (r.details ?? {}) as { distanceM?: number; accuracyM?: number; radiusM?: number };
    setCheck({ kind: 'rejected', code: r.code, message: r.message, distanceM: d.distanceM, accuracyM: d.accuracyM, radiusM: d.radiusM });
  };

  const doClockIn = async (site: AssignedSite) => {
    setCheck({ kind: 'locating' });
    const loc = await getCurrentFix(20_000, site);
    if (!loc.ok) return setCheck({ kind: 'locationProblem', problem: loc.problem });
    setCheck({ kind: 'sending' });
    handleResult(await clockIn(site, loc.fix));
  };

  const simple = async (fn: () => Promise<ActionResult>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) showMessage('Nicht möglich', r.message);
      // Offline gespeicherte Buchungen ausdrücklich anzeigen, damit nichts als serverbestätigt missverstanden wird.
      else setCheck(r.offline ? { kind: 'success', offline: true } : { kind: 'idle' });
    } finally {
      setBusy(false);
    }
  };

  const confirmClockOut = async () => {
    const ok = await confirmAction({
      title: 'Arbeitsende buchen?',
      message: 'Das Ausstempeln ist auch außerhalb der Baustelle möglich.',
      confirmText: 'Arbeitsende',
      destructive: true,
    });
    if (!ok) return;
    await simple(async () => {
      // Standort beim Ausstempeln ist optional und blockiert nie.
      const site = sites.find((s) => s.id === session?.siteId);
      const loc = await getCurrentFix(8000, site).catch(() => null);
      return clockOut(loc && loc.ok ? loc.fix : null);
    });
  };

  const status: { label: string; tone: Tone; icon: keyof typeof Ionicons.glyphMap } = !session
    ? { label: 'Nicht eingestempelt', tone: 'neutral', icon: 'ellipse-outline' }
    : onBreak
      ? { label: 'Pause läuft', tone: 'warning', icon: 'cafe' }
      : { label: 'Arbeitszeit läuft', tone: 'success', icon: 'play-circle' };

  return (
    <Screen>
      {!online && (
        <Notice tone="warning" title="Keine Verbindung" icon="cloud-offline">
          Buchungen werden auf dem Telefon gespeichert und später übertragen. Offline-Zeiten gelten als ungeprüft.
        </Notice>
      )}
      {conflicts.length > 0 && (
        <Pressable onPress={() => router.push('/more')}>
          <Notice tone="danger" title={`${conflicts.length} Buchung(en) abgelehnt`}>
            Tippen Sie hier, um die Details anzusehen.
          </Notice>
        </Pressable>
      )}

      {/* Status und Timer */}
      <Card style={[styles.statusCard, { borderColor: toneBorder[status.tone] }]}>
        <View style={styles.statusRow}>
          <Badge label={status.label} tone={status.tone} icon={status.icon} />
          {session && (
            <Badge
              label={session.pendingSync ? 'Ungeprüft · wartet auf Übertragung' : VERIFICATION_LABELS[session.verification]}
              tone={session.verification === 'verified' && !session.pendingSync ? 'success' : 'warning'}
              icon={session.verification === 'verified' && !session.pendingSync ? 'shield-checkmark' : 'alert-circle'}
            />
          )}
        </View>
        <Text style={styles.timer} accessibilityLabel={`Arbeitszeit ${formatDuration(totals?.netMs ?? 0)} Stunden`}>
          {formatClock(totals?.netMs ?? 0)}
        </Text>
        {session ? (
          <View style={{ gap: 2 }}>
            <Text style={styles.siteName}>{session.siteName}</Text>
            <P muted>
              Beginn {fmtTime(session.startedAt)} · Pause {formatDuration(totals?.breakMs ?? 0)} Std.
            </P>
          </View>
        ) : (
          <P muted>Netto-Arbeitszeit heute</P>
        )}
      </Card>

      {/* Rückmeldung direkt unter dem Status, damit sie ohne Scrollen sichtbar ist */}
      <CheckFeedback check={check} siteId={selected?.id ?? session?.siteId ?? null} onRetry={() => selected && doClockIn(selected)} />

      {/* Aktionen */}
      {session ? (
        <View style={{ gap: space.sm }}>
          {onBreak ? (
            <Button title="Arbeit fortsetzen" icon="play" variant="success" big onPress={() => simple(resume)} loading={busy} />
          ) : (
            <Button title="Pause" icon="cafe" variant="accent" big onPress={() => simple(pause)} loading={busy} />
          )}
          <Button title="Arbeitsende" icon="stop-circle" variant="danger" big onPress={confirmClockOut} disabled={busy} />
        </View>
      ) : (
        <>
          <H2>Baustelle heute</H2>
          {todaySites.length === 0 ? (
            <Notice tone="info" title="Keine Baustelle zugewiesen">
              Für heute ist Ihnen keine Baustelle zugewiesen. Bitte wenden Sie sich an Ihre Bauleitung.
            </Notice>
          ) : (
            todaySites.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  setSelectedId(s.id);
                  setCheck({ kind: 'idle' });
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked: s.id === selectedId }}
                style={[styles.siteOption, s.id === selectedId && styles.siteOptionActive]}
              >
                <Ionicons name={s.id === selectedId ? 'radio-button-on' : 'radio-button-off'} size={26} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteName}>{s.name}</Text>
                  <P muted small>
                    {s.street}, {s.zip} {s.city}
                  </P>
                </View>
              </Pressable>
            ))
          )}
          <Button
            title={check.kind === 'locating' ? 'Standort wird ermittelt …' : check.kind === 'sending' ? 'Wird geprüft …' : 'Standort prüfen & einstempeln'}
            icon="location"
            variant="success"
            big
            disabled={!selected}
            loading={check.kind === 'locating' || check.kind === 'sending'}
            onPress={() => selected && doClockIn(selected)}
            accessibilityHint="Ermittelt einmalig Ihren Standort und prüft ihn gegen die Baustelle"
          />
          <P muted small>
            Der Standort wird nur beim Einstempeln einmalig abgefragt – keine dauerhafte Ortung.
          </P>
        </>
      )}

      {pendingCount > 0 && (
        <Card>
          <P>
            <Text style={{ fontWeight: '800' }}>{pendingCount}</Text> Eintrag/Einträge warten auf Übertragung.
          </P>
          <Button title="Jetzt übertragen" icon="sync" variant="secondary" onPress={() => syncNow()} loading={syncing} disabled={!online} />
        </Card>
      )}
    </Screen>
  );
}

function CheckFeedback({ check, siteId, onRetry }: { check: CheckState; siteId: string | null; onRetry: () => void }) {
  const requestCorrection = () => router.push({ pathname: '/correction-request', params: siteId ? { siteId } : {} });
  if (check.kind === 'success') {
    return check.offline ? (
      <Notice tone="warning" title="Offline gespeichert">
        Die Buchung wurde mit der Uhrzeit des Telefons gespeichert und wird übertragen, sobald eine Verbindung besteht. Sie gilt bis zur Prüfung als ungeprüft.
      </Notice>
    ) : (
      <Notice tone="success" title="Gebucht">
        Die Buchung wurde vom Server bestätigt.
      </Notice>
    );
  }
  if (check.kind === 'locationProblem') {
    const blocked = check.problem === 'PERMISSION_BLOCKED';
    return (
      <Card>
        <Notice tone="warning" title="Standort nicht verfügbar">
          {LOCATION_PROBLEM_TEXT[check.problem]}
        </Notice>
        {blocked && <Button title="Einstellungen öffnen" icon="settings" variant="secondary" onPress={openSettings} />}
        <Button title="Erneut prüfen" icon="refresh" onPress={onRetry} />
        <Button title="Korrektur beantragen" variant="ghost" icon="create" onPress={requestCorrection} />
      </Card>
    );
  }
  if (check.kind === 'rejected') {
    const isLocation = LOCATION_CODES.includes(check.code);
    return (
      <Card>
        <Notice tone="danger" title="Einstempeln nicht möglich">
          <View style={{ gap: 4 }}>
            <P>{check.message}</P>
            {check.code === 'OUTSIDE_RADIUS' && check.distanceM != null && (
              <P small>
                Entfernung zur Baustelle: {fmtMeters(check.distanceM)} (erlaubt: {check.radiusM} m)
              </P>
            )}
            {check.accuracyM != null && <P small>Genauigkeit des Standorts: ± {Math.round(check.accuracyM)} m</P>}
          </View>
        </Notice>
        {isLocation && <Button title="Erneut prüfen" icon="refresh" onPress={onRetry} />}
        <Button title="Korrektur beantragen" variant={isLocation ? 'ghost' : 'secondary'} icon="create" onPress={requestCorrection} />
      </Card>
    );
  }
  return null;
}

const toneBorder: Record<Tone, string> = {
  success: colors.success,
  warning: colors.accent,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.border,
};

const styles = StyleSheet.create({
  statusCard: { borderWidth: 2, alignItems: 'stretch', paddingVertical: space.lg },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  timer: { fontSize: font.huge, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  siteName: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  siteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch.big,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  siteOptionActive: { borderColor: colors.primary, backgroundColor: colors.infoBg },
});
