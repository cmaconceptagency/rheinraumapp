import { useCallback, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { ReportDto } from '@rheinraum/shared';
import { apiBaseUrl, authHeaders, errorMessage, NetworkError, request } from '../../api/client';
import { useAppData } from '../../state/AppData';
import { fmtDate, localDate } from '../../lib/format';
import { readJson, writeJson } from '../../lib/storage';
import { Badge, Button, Card, H2, Loading, Notice, P, Row, Screen } from '../../ui/components';
import { space } from '../../ui/theme';

const CACHE_KEY = 'rr.reports';

export default function Reports() {
  const { pendingItems } = useAppData();
  const [reports, setReports] = useState<ReportDto[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const to = localDate();
    const from = localDate(new Date(Date.now() - 30 * 86400_000));
    try {
      const res = await request<{ reports: ReportDto[] }>(`/api/me/reports?from=${from}&to=${to}`);
      setReports(res.reports);
      setNotice(null);
      await writeJson(CACHE_KEY, res.reports);
    } catch (err) {
      setReports(await readJson<ReportDto[]>(CACHE_KEY, []));
      setNotice(err instanceof NetworkError ? 'Offline – zuletzt geladener Stand.' : errorMessage(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pendingReports = pendingItems.flatMap((i) => (i.kind === 'report' ? [i] : []));
  const pendingPhotos = pendingItems.filter((i) => i.kind === 'photo').length;

  return (
    <Screen>
      <Button title="Neuer Bericht" icon="add-circle" variant="accent" big onPress={() => router.push('/report-new')} />
      {notice && <Notice tone="warning">{notice}</Notice>}
      {(pendingReports.length > 0 || pendingPhotos > 0) && (
        <Notice tone="info" title="Wartet auf Übertragung">
          {`${pendingReports.length} Bericht(e) und ${pendingPhotos} Foto(s) werden übertragen, sobald eine Verbindung besteht.`}
        </Notice>
      )}
      {pendingReports.map((i) => (
        <Card key={i.id}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <H2>{fmtDate(i.report.reportDate)}</H2>
            <Badge label="Nicht übertragen" tone="warning" icon="cloud-upload" />
          </Row>
          <P muted small>{i.report.siteName}</P>
          <P>{i.report.workDone}</P>
        </Card>
      ))}
      {reports === null ? (
        <Loading />
      ) : reports.length === 0 && pendingReports.length === 0 ? (
        <P muted>Noch keine Berichte in den letzten 30 Tagen.</P>
      ) : (
        reports.map((r) => (
          <Card key={r.id}>
            <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <H2>{fmtDate(r.reportDate)}</H2>
              <Badge label="Übertragen" tone="success" icon="checkmark" />
            </Row>
            <P muted small>{r.siteName}</P>
            <P>{r.workDone}</P>
            {r.remarks ? <P muted>Bemerkung: {r.remarks}</P> : null}
            {r.photos.length > 0 && (
              <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
                {r.photos.map((p) => (
                  <Image
                    key={p.id}
                    source={{ uri: `${apiBaseUrl()}${p.url}`, headers: authHeaders() }}
                    style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: '#ddd' }}
                    accessibilityLabel="Foto zum Bericht"
                  />
                ))}
              </ScrollView>
            )}
          </Card>
        ))
      )}
      <View style={{ height: space.md }} />
    </Screen>
  );
}
