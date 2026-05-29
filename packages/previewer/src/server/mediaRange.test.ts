import assert from "node:assert/strict";
import test from "node:test";

import { resolveMediaRange } from "./mediaRange.js";

test("returns full response when no Range header is present", () => {
  assert.deepEqual(resolveMediaRange(undefined, 1000), { kind: "full" });
});

test("resolves a valid bounded byte range", () => {
  assert.deepEqual(resolveMediaRange("bytes=100-199", 1000), {
    kind: "partial",
    start: 100,
    end: 199,
    contentLength: 100,
    contentRange: "bytes 100-199/1000",
  });
});

test("resolves an open-ended byte range", () => {
  assert.deepEqual(resolveMediaRange("bytes=900-", 1000), {
    kind: "partial",
    start: 900,
    end: 999,
    contentLength: 100,
    contentRange: "bytes 900-999/1000",
  });
});

test("resolves a suffix byte range", () => {
  assert.deepEqual(resolveMediaRange("bytes=-250", 1000), {
    kind: "partial",
    start: 750,
    end: 999,
    contentLength: 250,
    contentRange: "bytes 750-999/1000",
  });
});

test("returns invalid for unsatisfiable ranges", () => {
  assert.deepEqual(resolveMediaRange("bytes=1000-1200", 1000), {
    kind: "invalid",
    contentRange: "bytes */1000",
  });
});
