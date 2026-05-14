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
import { polyfill as polyfillFetch } from 'react-native-polyfill-globals/src/fetch';

polyfillBase64();
polyfillEncoding();
polyfillReadableStream();
polyfillUrl();
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
