import { useState } from 'react';
import { Linking, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { DistanceDto } from '@rheinraum/shared';
import { useAppData, type AssignedSite } from '../../state/AppData';
import { errorMessage, request } from '../../api/client';
import { fmtDate, fmtKm } from '../../lib/format';
import { Badge, Button, Card, H2, Notice, P, Row } from '../../ui/components';
import { colors, space } from '../../ui/theme';

export default function Sites() {
  const { sites, refresh, online } = useAppData();
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xl }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refresh().catch(() => undefined);
            setRefreshing(false);
          }}
        />
      }
    >
      {!online && <Notice tone="warning">Offline – angezeigt wird der zuletzt geladene Stand.</Notice>}
      {sites.length === 0 && <Notice tone="info">Ihnen sind derzeit keine Baustellen zugewiesen.</Notice>}
      {sites.map((s) => (
        <SiteCard key={s.id} site={s} online={online} />
      ))}
    </ScrollView>
  );
}

function SiteCard({ site, online }: { site: AssignedSite; online: boolean }) {
  const [distance, setDistance] = useState<DistanceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const address = `${site.street}, ${site.zip} ${site.city}`;

  const loadDistance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await request<{ distance: DistanceDto }>(`/api/me/sites/${site.id}/distance`);
      setDistance(res.distance);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const openMaps = () => {
    const q = encodeURIComponent(address);
    Linking.openURL(Platform.OS === 'ios' ? `maps://?q=${q}&ll=${site.lat},${site.lng}` : `geo:${site.lat},${site.lng}?q=${q}`);
  };

  return (
    <Card>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <H2>{site.name}</H2>
        {site.activeToday ? <Badge label="Heute" tone="success" icon="today" /> : <Badge label={`ab ${fmtDate(site.assignment.validFrom)}`} tone="info" />}
      </Row>
      <P>{address}</P>
      <P muted small>
        Zugewiesen {fmtDate(site.assignment.validFrom)}
        {site.assignment.validTo ? ` bis ${fmtDate(site.assignment.validTo)}` : ' (unbefristet)'} · Radius {site.radiusM} m
      </P>
      {site.contactName && (
        <View style={{ gap: 2 }}>
          <Text style={{ fontWeight: '700', fontSize: 15, color: colors.textMuted }}>Ansprechpartner</Text>
          <P>{site.contactName}</P>
        </View>
      )}
      {site.notes ? <P muted small>{site.notes}</P> : null}
      <Row style={{ flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button title="Karte" icon="map" variant="secondary" onPress={openMaps} />
        </View>
        {site.contactPhone && (
          <View style={{ flex: 1, minWidth: 140 }}>
            <Button title="Anrufen" icon="call" variant="secondary" onPress={() => Linking.openURL(`tel:${site.contactPhone}`)} />
          </View>
        )}
      </Row>
      {distance ? (
        <View style={{ gap: 4, paddingTop: 4 }}>
          <Row style={{ flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 22, fontWeight: '900', color: colors.text }}>{fmtKm(distance.distanceM)}</Text>
            <Badge label="Einfache Strecke" tone="info" icon="arrow-forward" />
            {distance.simulated && <Badge label="Simuliert" tone="warning" icon="flask" />}
          </Row>
          <P muted small>
            Straßenentfernung Wohnort → Baustelle (nur Hinweg)
            {distance.durationS ? ` · ca. ${Math.round(distance.durationS / 60)} Min. Fahrt` : ''}
            {distance.simulated ? ' · Näherungswert, keine echte Routenberechnung' : ''}
          </P>
        </View>
      ) : (
        <Button title="Entfernung vom Wohnort berechnen" icon="car" variant="ghost" onPress={loadDistance} loading={loading} disabled={!online} />
      )}
      {error && <Notice tone="warning">{error}</Notice>}
    </Card>
  );
}
