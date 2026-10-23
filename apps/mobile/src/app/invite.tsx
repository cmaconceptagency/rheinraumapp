import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Button, Card, Field, Notice, P, Screen } from '../ui/components';

export default function Invite() {
  const { acceptInvite } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptInvite(email, code, pw);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card style={{ gap: 16 }}>
        <P muted>Den Einladungscode erhalten Sie von Ihrer Firma. Danach legen Sie Ihr eigenes Passwort fest.</P>
        <Field label="E-Mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Einladungscode" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" />
        <Field label="Neues Passwort" value={pw} onChangeText={setPw} secureTextEntry hint="Mindestens 10 Zeichen" textContentType="newPassword" />
        <Field label="Passwort wiederholen" value={pw2} onChangeText={setPw2} secureTextEntry error={mismatch ? 'Passwörter stimmen nicht überein' : undefined} />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button title="Konto aktivieren" icon="checkmark" big onPress={submit} loading={busy} disabled={!email || !code || pw.length < 10 || pw !== pw2} />
      </Card>
    </Screen>
  );
}
