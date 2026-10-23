import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStorage } from '../sync/queue';

/** Nicht-geheime Daten (Warteschlange, Zwischenspeicher). Zugangsdaten liegen im SecureStore. */
export const kv: KeyValueStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const writeJson = (key: string, value: unknown) => AsyncStorage.setItem(key, JSON.stringify(value));
export const removeKeys = (keys: string[]) => AsyncStorage.multiRemove(keys);
