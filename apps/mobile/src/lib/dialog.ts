import { Alert } from 'react-native';

export function showMessage(title: string, message: string): void {
  Alert.alert(title, message);
}

/** Bestätigungsdialog; liefert true, wenn bestätigt wurde. */
export function confirmAction(opts: { title: string; message: string; confirmText: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(opts.title, opts.message, [
      { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
      { text: opts.confirmText, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}
