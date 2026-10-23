import { View } from 'react-native';
import { router } from 'expo-router';
import { ROLE_LABELS } from '@rheinraum/shared';
import { useAuth } from '../../auth/AuthContext';
import { useAppData } from '../../state/AppData';
import { apiBaseUrl } from '../../api/client';
import { confirmAction } from '../../lib/dialog';
import { fmtDate, fmtTime } from '../../lib/format';
import { Button, Card, H2, ListItem, Notice, P, Screen } from '../../ui/components';

export default function More() {
  const { user, logout } = useAuth();
  const { conflicts, dismissConflict, pendingCount, syncNow, syncing, online, lastSyncError, clearLocalData } = useAppData();

  const doLogout = () => {
    const warn =
      pendingCount > 0
        ? `Achtung: ${pendingCount} Eintrag/Einträge wurden noch nicht übertragen und gehen beim Abmelden verloren.`
        : 'Möchten Sie sich abmelden?';
    confirmAction({ title: 'Abmelden', message: warn, confirmText: 'Abmelden', destructive: true }).then(async (ok) => {
      if (!ok) return;
      await clearLocalData();
      await logout();
    });
  };

  return (
    <Screen>
      <Card>
        <H2>
          {user?.firstName} {user?.lastName}
        </H2>
        <P muted>
          {user ? ROLE_LABELS[user.role] : ''} · {user?.companyName}
        </P>
        <P muted small>{user?.email}</P>
      </Card>

      <Card>
        <ListItem icon="medkit" title="Krankmeldung" subtitle="Beginn und voraussichtliches Ende melden" onPress={() => router.push('/sick-note')} />
        <ListItem icon="create" title="Korrektur beantragen" subtitle="z. B. wenn das Einstempeln nicht möglich war" onPress={() => router.push('/correction-request')} />
      </Card>

      <Card>
        <H2>Synchronisation</H2>
        <P>{online ? 'Verbunden' : 'Keine Verbindung'} · {pendingCount} Eintrag/Einträge ausstehend</P>
        {lastSyncError && pendingCount > 0 && <P muted small>Letzter Versuch: {lastSyncError}</P>}
        <Button title="Jetzt übertragen" icon="sync" variant="secondary" onPress={() => syncNow()} loading={syncing} disabled={!online || pendingCount === 0} />
      </Card>

      {conflicts.length > 0 && (
        <Card>
          <H2>Abgelehnte Einträge</H2>
          <P muted small>Diese Einträge hat der Server nicht übernommen. Bitte ggf. eine Korrektur beantragen.</P>
          {conflicts.map((c) => (
            <View key={c.itemId} style={{ gap: 6 }}>
              <Notice tone="danger" title={c.summary}>
                {`${c.message} (${fmtDate(c.at)} ${fmtTime(c.at)})`}
              </Notice>
              <Button title="Ausblenden" variant="ghost" onPress={() => dismissConflict(c.itemId)} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <P muted small>
          Datenschutz: Der Standort wird nur beim Einstempeln (und optional beim Ausstempeln) einmalig abgefragt. Es findet keine
          dauerhafte Standortüberwachung statt. Standortdaten sind kein absolut manipulationssicherer Anwesenheitsnachweis.
        </P>
        <P muted small>Server: {apiBaseUrl()}</P>
      </Card>

      <Button title="Abmelden" icon="log-out" variant="danger" onPress={doLogout} />
    </Screen>
  );
}
