import { Redirect } from 'expo-router';

// Unbekannte Pfade (z. B. Deep Links auf entfernte Seiten) führen zur Startseite.
export default function NotFound() {
  return <Redirect href="/" />;
}
