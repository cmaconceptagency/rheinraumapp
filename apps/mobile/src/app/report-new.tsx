import { useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useAppData } from '../state/AppData';
import { localDate } from '../lib/format';
import { showMessage } from '../lib/dialog';
import { persistPhoto } from '../lib/photos';
import { Button, Card, Field, Notice, P, Row, Screen } from '../ui/components';
import { DateTimeField } from '../ui/DateTimeField';
import { SitePicker } from '../ui/SitePicker';
import { colors, space } from '../ui/theme';

interface PickedPhoto {
  uri: string;
  mime: string;
}

const MAX_PHOTOS = 10;

export default function ReportNew() {
  const { sites, session, enqueue } = useAppData();
  const [date, setDate] = useState(() => new Date());
  const [siteId, setSiteId] = useState<string | null>(session?.siteId ?? sites.find((s) => s.activeToday)?.id ?? null);
  const [workDone, setWorkDone] = useState('');
  const [remarks, setRemarks] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const addPhoto = async (source: 'camera' | 'library') => {
    const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showMessage('Berechtigung fehlt', source === 'camera' ? 'Bitte den Kamerazugriff erlauben.' : 'Bitte den Zugriff auf Fotos erlauben.');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length });
    if (res.canceled) return;
    setPhotos((p) => [...p, ...res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' }))].slice(0, MAX_PHOTOS));
  };

  const save = async () => {
    if (!siteId) return;
    const site = sites.find((s) => s.id === siteId);
    setSaving(true);
    try {
      const reportClientId = Crypto.randomUUID();
      // Fotos dauerhaft in den App-Speicher kopieren, damit sie auch nach Neustart noch hochgeladen werden können.
      const copies: { clientId: string; fileUri: string; mime: string }[] = [];
      for (const p of photos) {
        const clientId = Crypto.randomUUID();
        copies.push({ clientId, fileUri: await persistPhoto(p.uri, p.mime, clientId), mime: p.mime });
      }
      await enqueue({
        kind: 'report',
        report: { clientId: reportClientId, siteId, siteName: site?.name, reportDate: localDate(date), workDone: workDone.trim(), remarks: remarks.trim() || null },
      });
      for (const c of copies) await enqueue({ kind: 'photo', photo: { ...c, reportClientId } });
      router.back();
    } catch (err) {
      showMessage('Speichern fehlgeschlagen', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {sites.length === 0 && <Notice tone="info">Ihnen ist keine Baustelle zugewiesen.</Notice>}
      <Card style={{ gap: space.md }}>
        <DateTimeField label="Datum" mode="date" value={date} onChange={setDate} maximumDate={new Date()} />
        <SitePicker sites={sites} value={siteId} onChange={setSiteId} />
        <Field label="Ausgeführte Arbeiten" value={workDone} onChangeText={setWorkDone} multiline placeholder="z. B. Schalung Decke 2. OG gestellt" />
        <Field label="Bemerkungen (optional)" value={remarks} onChangeText={setRemarks} multiline placeholder="z. B. Material fehlt, Behinderungen" />
      </Card>
      <Card>
        <P>
          Fotos ({photos.length}/{MAX_PHOTOS})
        </P>
        {photos.length > 0 && (
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
            {photos.map((p, i) => (
              <View key={p.uri}>
                <Image source={{ uri: p.uri }} style={{ width: 96, height: 96, borderRadius: 10 }} />
                <Pressable
                  accessibilityLabel="Foto entfernen"
                  onPress={() => setPhotos((list) => list.filter((_, idx) => idx !== i))}
                  style={{ position: 'absolute', top: -6, right: -6, backgroundColor: colors.danger, borderRadius: 14, padding: 4 }}
                >
                  <Ionicons name="close" size={18} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        <Row>
          <View style={{ flex: 1 }}>
            <Button title="Kamera" icon="camera" variant="secondary" onPress={() => addPhoto('camera')} disabled={photos.length >= MAX_PHOTOS} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Galerie" icon="images" variant="secondary" onPress={() => addPhoto('library')} disabled={photos.length >= MAX_PHOTOS} />
          </View>
        </Row>
      </Card>
      <Button title="Bericht speichern" icon="save" big onPress={save} loading={saving} disabled={!siteId || !workDone.trim()} />
      <P muted small>Ohne Verbindung wird der Bericht auf dem Telefon gespeichert und später automatisch übertragen.</P>
    </Screen>
  );
}
