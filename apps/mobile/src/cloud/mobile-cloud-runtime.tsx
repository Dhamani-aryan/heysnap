import { CloudRuntimeProvider } from '@ank1015-app/ui/cloud-runtime';
import { useBootstrapAuth, type CloudSessionStorage } from '@ank1015-app/ui/cloud-hooks';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type MobileCloudRuntimeProviderProps = {
  children: React.ReactNode;
};

const CLOUD_SERVER_URL = 'https://api.heysnap.xyz';
const MOBILE_STORAGE_KEY = 'ank1015:mobile-session-token';

const secureStorage: CloudSessionStorage = {
  readToken: (storageKey) => readValue(storageKey),
  writeToken: (storageKey, token) => writeValue(storageKey, token),
  removeToken: (storageKey) => removeValue(storageKey),
  readBoolean: async (storageKey) => (await readValue(storageKey)) === 'true',
  writeBoolean: (storageKey, value) => writeValue(storageKey, value ? 'true' : 'false'),
  removeBoolean: (storageKey) => removeValue(storageKey),
};

export function MobileCloudRuntimeProvider({ children }: MobileCloudRuntimeProviderProps) {
  return (
    <CloudRuntimeProvider
      cloudServerUrl={CLOUD_SERVER_URL}
      storage={secureStorage}
      storageKey={MOBILE_STORAGE_KEY}>
      {children}
    </CloudRuntimeProvider>
  );
}

export function MobileCloudBootstrap() {
  useBootstrapAuth();
  return null;
}

async function readValue(storageKey: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(storageKey) ?? null;
  }

  return SecureStore.getItemAsync(toSecureStoreKey(storageKey));
}

async function writeValue(storageKey: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(storageKey, value);
    return;
  }

  await SecureStore.setItemAsync(toSecureStoreKey(storageKey), value);
}

async function removeValue(storageKey: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.removeItem(storageKey);
    return;
  }

  await SecureStore.deleteItemAsync(toSecureStoreKey(storageKey));
}

function toSecureStoreKey(storageKey: string): string {
  return storageKey.replace(/[^A-Za-z0-9._-]/g, '.');
}
