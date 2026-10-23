// Web (nur Browser-Demo): expo-secure-store hat keine Web-Implementierung. Die Mitarbeiter-App ist für iOS/Android
// gedacht; im Browser wird das Token nur für die Dauer des Tabs in sessionStorage gehalten.
const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};
export const getItemAsync = async (key: string) => safe(() => sessionStorage.getItem(key), null);
export const setItemAsync = async (key: string, value: string) => safe(() => sessionStorage.setItem(key, value), undefined);
export const deleteItemAsync = async (key: string) => safe(() => sessionStorage.removeItem(key), undefined);
