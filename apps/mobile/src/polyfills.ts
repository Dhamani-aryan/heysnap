// Polyfills required for streaming fetch (SSE) on React Native.
// Must be imported once, before any module that calls fetch on a streaming
// endpoint. The shared agent-client uses `response.body.getReader()`, and
// react-native-fetch-api only exposes a streaming body when callers pass
// `reactNative: { textStreaming: true }`. We default that flag on for every
// fetch so the shared client (which is web-shaped) just works.

import { polyfill as polyfillBase64 } from 'react-native-polyfill-globals/src/base64';
import { polyfill as polyfillEncoding } from 'react-native-polyfill-globals/src/encoding';
import { polyfill as polyfillReadableStream } from 'react-native-polyfill-globals/src/readable-stream';
import { polyfill as polyfillUrl } from 'react-native-polyfill-globals/src/url';
import { Platform } from 'react-native';

polyfillBase64();
polyfillEncoding();
polyfillReadableStream();
polyfillUrl();

if (Platform.OS !== 'web') {
  // Native-only polyfill cannot be imported during web/static rendering.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fetchPolyfillModule = require('react-native-polyfill-globals/src/fetch') as typeof import('react-native-polyfill-globals/src/fetch');
  const { polyfill: polyfillFetch } = fetchPolyfillModule;

  polyfillFetch();

  const baseFetch = globalThis.fetch;

  const wrappedFetch: typeof fetch = (input, init) => {
    const reactNative = {
      textStreaming: true,
      ...((init as { reactNative?: Record<string, unknown> } | undefined)?.reactNative ?? {}),
    };
    return baseFetch(input as RequestInfo, { ...init, reactNative } as RequestInit);
  };

  (globalThis as { fetch: typeof fetch }).fetch = wrappedFetch;
}
