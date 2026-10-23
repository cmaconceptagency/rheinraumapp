import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../state/AppData';
import { localDate } from '../lib/format';
import { Button, Card, Notice, Row, Screen } from '../ui/components';
import { DateTimeField } from '../ui/DateTimeField';
import { colors, space, touch } from '../ui/theme';

/** Krankmeldung – bewusst ohne Diagnosefeld. */
export default function SickNote() {
  const { enqueue } = useAppData();
  const [start, setStart] = useState(() => new Date());
  const [end, setEnd] = useState(() => new Date());
  const [certificate, setCertificate] = useState(false);
  const [saving, setSaving] = useState(false);
  const invalid = localDate(end) < localDate(start);

  const save = async () => {
    setSaving(true);
    await enqueue({
      kind: 'sick_note',
      sickNote: { clientId: Crypto.randomUUID(), startDate: localDate(start), expectedEndDate: localDate(end), certificateProvided: certificate },
    });
    setSaving(false);
    router.back();
  };

  return (
    <Screen>
      <Notice tone="info">Bitte keine Diagnose angeben – sie wird nicht benötigt und nicht gespeichert.</Notice>
      <Card style={{ gap: space.md }}>
        <Row>
          <DateTimeField label="Krank seit" mode="date" value={start} onChange={setStart} />
          <DateTimeField label="Voraussichtlich bis" mode="date" value={end} onChange={setEnd} />
        </Row>
        {invalid && <Notice tone="danger">Das Ende darf nicht vor dem Beginn liegen.</Notice>}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: certificate }}
          onPress={() => setCertificate((c) => !c)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.min }}
        >
          <Ionicons name={certificate ? 'checkbox' : 'square-outline'} size={28} color={colors.primary} />
          <Text style={{ fontSize: 17, color: colors.text, flex: 1 }}>Arbeitsunfähigkeitsbescheinigung liegt vor</Text>
        </Pressable>
      </Card>
      <Button title="Krankmeldung senden" icon="send" big onPress={save} loading={saving} disabled={invalid} />
    </Screen>
  );
}
