import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../state/AppData';
import { Button, Card, Field, Notice, P, Row, Screen } from '../ui/components';
import { DateTimeField } from '../ui/DateTimeField';
import { SitePicker } from '../ui/SitePicker';
import { colors, space, touch } from '../ui/theme';

function combine(date: Date, time: Date) {
  const d = new Date(date);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
}

/** Begründete manuelle Korrekturanfrage, z. B. wenn das Einstempeln wegen fehlendem GPS nicht möglich war. */
export default function CorrectionRequest() {
  const params = useLocalSearchParams<{ siteId?: string }>();
  const { sites, enqueue } = useAppData();
  const [siteId, setSiteId] = useState<string | null>(params.siteId ?? sites.find((s) => s.activeToday)?.id ?? null);
  const [date, setDate] = useState(() => new Date());
  const [startTime, setStartTime] = useState(() => new Date());
  const [withEnd, setWithEnd] = useState(false);
  const [endTime, setEndTime] = useState(() => new Date());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const start = combine(date, startTime);
  const end = withEnd ? combine(date, endTime) : null;
  const invalid = !siteId || reason.trim().length < 10 || (end !== null && end <= start) || start > new Date(Date.now() + 5 * 60_000);

  const save = async () => {
    if (!siteId) return;
    setSaving(true);
    await enqueue({
      kind: 'correction',
      request: { clientId: Crypto.randomUUID(), siteId, requestedStart: start.toISOString(), requestedEnd: end?.toISOString() ?? null, reason: reason.trim() },
    });
    setSaving(false);
    router.back();
  };

  return (
    <Screen>
      <P muted>Die Bauleitung bzw. Verwaltung prüft die Anfrage. Erst nach Genehmigung wird die Zeit gebucht.</P>
      <Card style={{ gap: space.md }}>
        <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
        <DateTimeField label="Datum" mode="date" value={date} onChange={setDate} maximumDate={new Date()} />
        <Row>
          <DateTimeField label="Arbeitsbeginn" mode="time" value={startTime} onChange={setStartTime} />
          {withEnd && <DateTimeField label="Arbeitsende" mode="time" value={endTime} onChange={setEndTime} />}
        </Row>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: withEnd }}
          onPress={() => setWithEnd((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.min }}
        >
          <Ionicons name={withEnd ? 'checkbox' : 'square-outline'} size={28} color={colors.primary} />
          <Text style={{ fontSize: 17, color: colors.text }}>Arbeitsende ebenfalls angeben</Text>
        </Pressable>
        {end && end <= start && <Notice tone="danger">Das Arbeitsende muss nach dem Beginn liegen.</Notice>}
        <Field
          label="Begründung"
          value={reason}
          onChangeText={setReason}
          multiline
          placeholder="z. B. Kein GPS-Empfang im Keller, Einstempeln nicht möglich"
          hint="Mindestens 10 Zeichen"
        />
      </Card>
      <Button title="Anfrage senden" icon="send" big onPress={save} loading={saving} disabled={invalid} />
    </Screen>
  );
}
