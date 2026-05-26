import { describe, expect, it, vi } from "vitest";

import {
  decodeTunnelBinaryFrame,
  encodeTunnelBinaryFrame,
  parseTunnelControlMessage,
  stringifyTunnelControlMessage,
  TUNNEL_BINARY_FRAME_TYPES,
  TunnelSendScheduler,
  TUNNEL_OVERLOAD_CLOSE_CODE,
  TUNNEL_QUEUE_PROFILES,
} from "../src/index.js";

const CONNECTION_ID = "11111111-2222-4333-8444-555555555555";

describe("tunnel protocol binary frames", () => {
  it("encodes and decodes websocket data frames", () => {
    const encoded = encodeTunnelBinaryFrame({
      type: "wsData",
      connectionId: CONNECTION_ID,
      payload: Buffer.from("hello", "utf8"),
      isText: true,
    });

    expect(encoded[0]).toBe(1);
    expect(encoded[1]).toBe(TUNNEL_BINARY_FRAME_TYPES.wsData);
    expect(decodeTunnelBinaryFrame(encoded)).toEqual({
      type: "wsData",
      connectionId: CONNECTION_ID,
      payload: Buffer.from("hello", "utf8"),
      isText: true,
    });
  });

  it("encodes and decodes HTTP body frames", () => {
    const request = decodeTunnelBinaryFrame(encodeTunnelBinaryFrame({
      type: "httpRequestBody",
      connectionId: CONNECTION_ID,
      payload: Buffer.from([1, 2, 3]),
      isText: false,
    }));
    const response = decodeTunnelBinaryFrame(encodeTunnelBinaryFrame({
      type: "httpResponseBody",
      connectionId: CONNECTION_ID,
      payload: Buffer.from([4, 5]),
      isText: false,
    }));

    expect(request?.type).toBe("httpRequestBody");
    expect(request?.payload).toEqual(Buffer.from([1, 2, 3]));
    expect(response?.type).toBe("httpResponseBody");
    expect(response?.payload).toEqual(Buffer.from([4, 5]));
  });

  it("rejects invalid binary frames", () => {
    const valid = encodeTunnelBinaryFrame({
      type: "wsData",
      connectionId: CONNECTION_ID,
      payload: Buffer.from("x"),
      isText: false,
    });

    expect(decodeTunnelBinaryFrame(valid.subarray(0, 19))).toBeNull();

    const invalidVersion = Buffer.from(valid);
    invalidVersion[0] = 2;
    expect(decodeTunnelBinaryFrame(invalidVersion)).toBeNull();

    const invalidType = Buffer.from(valid);
    invalidType[1] = 99;
    expect(decodeTunnelBinaryFrame(invalidType)).toBeNull();

    const invalidFlags = Buffer.from(valid);
    invalidFlags[2] = 0b10;
    expect(decodeTunnelBinaryFrame(invalidFlags)).toBeNull();

    const invalidReserved = Buffer.from(valid);
    invalidReserved[3] = 1;
    expect(decodeTunnelBinaryFrame(invalidReserved)).toBeNull();

    expect(() => encodeTunnelBinaryFrame({
      type: "wsData",
      connectionId: "not-a-uuid",
      payload: Buffer.from("x"),
      isText: false,
    })).toThrow("UUID");
  });
});

describe("tunnel control messages", () => {
  it("round-trips JSON control frames", () => {
    const message = {
      type: "httpRequestStart",
      connectionId: CONNECTION_ID,
      path: "/filesystem/uploads",
      method: "POST",
      headers: { "content-type": "application/json" },
      trafficClass: "filesystem:upload",
    } as const;

    expect(parseTunnelControlMessage(stringifyTunnelControlMessage(message))).toEqual(message);
  });
});

describe("tunnel send scheduler", () => {
  it("queues while the physical websocket is above high water and drains later", async () => {
    vi.useFakeTimers();
    const sent: Array<string | Buffer> = [];
    let bufferedAmount = 10;
    const scheduler = new TunnelSendScheduler({
      socket: {
        readyState: 1,
        get bufferedAmount() {
          return bufferedAmount;
        },
        send: (data, callback) => {
          sent.push(data);
          callback?.();
        },
      },
      isOpen: () => true,
      highWaterBytes: 8,
      lowWaterBytes: 2,
      drainIntervalMs: 1,
    });

    const sendPromise = scheduler.enqueue({
      connectionId: CONNECTION_ID,
      data: "queued",
      profile: TUNNEL_QUEUE_PROFILES["filesystem:ws"],
    });

    expect(sent).toEqual([]);
    bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(1);
    await sendPromise;

    expect(sent).toEqual(["queued"]);
    vi.useRealTimers();
  });

  it("closes only the overflowing logical route", async () => {
    const overloaded: string[] = [];
    const scheduler = new TunnelSendScheduler({
      socket: {
        readyState: 1,
        bufferedAmount: 10,
        send: () => undefined,
      },
      isOpen: () => true,
      highWaterBytes: 1,
      totalQueuedBytes: 100,
      onConnectionOverflow: (connectionId) => overloaded.push(connectionId),
    });

    await expect(scheduler.enqueue({
      connectionId: CONNECTION_ID,
      data: Buffer.alloc(TUNNEL_QUEUE_PROFILES["filesystem:ws"].maxQueuedBytes + 1),
      profile: TUNNEL_QUEUE_PROFILES["filesystem:ws"],
    })).rejects.toThrow("Tunnel overloaded");

    expect(overloaded).toEqual([CONNECTION_ID]);
    expect(TUNNEL_OVERLOAD_CLOSE_CODE).toBe(1013);
  });

  it("closes the largest queued bulk route first when the total queue overflows", async () => {
    const sent: Array<string | Buffer> = [];
    const overloaded: string[] = [];
    let bufferedAmount = 10;
    const controlConnectionId = "aaaaaaaa-2222-4333-8444-555555555555";
    const bulkConnectionId = "bbbbbbbb-2222-4333-8444-555555555555";
    const scheduler = new TunnelSendScheduler({
      socket: {
        readyState: 1,
        get bufferedAmount() {
          return bufferedAmount;
        },
        send: (data, callback) => {
          sent.push(data);
          callback?.();
        },
      },
      isOpen: () => true,
      highWaterBytes: 8,
      lowWaterBytes: 2,
      totalQueuedBytes: 12,
      onConnectionOverflow: (connectionId) => overloaded.push(connectionId),
    });

    const control = scheduler.enqueue({
      connectionId: controlConnectionId,
      data: Buffer.alloc(6, "c"),
      profile: TUNNEL_QUEUE_PROFILES["browser-control:ws"],
    });
    const bulk = scheduler.enqueue({
      connectionId: bulkConnectionId,
      data: Buffer.alloc(8, "b"),
      profile: TUNNEL_QUEUE_PROFILES["filesystem:download"],
    });

    await expect(bulk).rejects.toThrow("Tunnel overloaded");
    expect(overloaded).toEqual([bulkConnectionId]);

    bufferedAmount = 0;
    scheduler.drainNow();
    await control;

    expect(sent).toEqual([Buffer.alloc(6, "c")]);
  });

  it("sends higher-priority connections before bulk connections", async () => {
    const sent: string[] = [];
    let bufferedAmount = 10;
    const scheduler = new TunnelSendScheduler({
      socket: {
        readyState: 1,
        get bufferedAmount() {
          return bufferedAmount;
        },
        send: (data, callback) => {
          sent.push(String(data));
          callback?.();
        },
      },
      isOpen: () => true,
      highWaterBytes: 8,
      lowWaterBytes: 2,
    });

    const bulk = scheduler.enqueue({
      connectionId: "aaaaaaaa-2222-4333-8444-555555555555",
      data: "bulk",
      profile: TUNNEL_QUEUE_PROFILES["filesystem:download"],
    });
    const control = scheduler.enqueue({
      connectionId: "bbbbbbbb-2222-4333-8444-555555555555",
      data: "control",
      profile: TUNNEL_QUEUE_PROFILES["browser-control:ws"],
    });

    bufferedAmount = 0;
    scheduler.drainNow();
    await Promise.all([bulk, control]);

    expect(sent).toEqual(["control", "bulk"]);
  });

  it("keeps bulk transfers progressing during sustained control traffic", async () => {
    const sent: string[] = [];
    let bufferedAmount = 10;
    const scheduler = new TunnelSendScheduler({
      socket: {
        readyState: 1,
        get bufferedAmount() {
          return bufferedAmount;
        },
        send: (data, callback) => {
          sent.push(String(data));
          callback?.();
        },
      },
      isOpen: () => true,
      highWaterBytes: 8,
      lowWaterBytes: 2,
    });

    const sends: Array<Promise<void>> = [];
    for (let index = 0; index < 10; index += 1) {
      sends.push(scheduler.enqueue({
        connectionId: "aaaaaaaa-2222-4333-8444-555555555555",
        data: `control-${String(index)}`,
        profile: TUNNEL_QUEUE_PROFILES["browser-control:ws"],
      }));
    }
    sends.push(scheduler.enqueue({
      connectionId: "bbbbbbbb-2222-4333-8444-555555555555",
      data: "bulk-0",
      profile: TUNNEL_QUEUE_PROFILES["filesystem:download"],
    }));
    sends.push(scheduler.enqueue({
      connectionId: "bbbbbbbb-2222-4333-8444-555555555555",
      data: "bulk-1",
      profile: TUNNEL_QUEUE_PROFILES["filesystem:download"],
    }));

    bufferedAmount = 0;
    scheduler.drainNow();
    await Promise.all(sends);

    expect(sent).toContain("bulk-0");
    expect(sent).toContain("bulk-1");
    expect(sent.indexOf("bulk-0")).toBeLessThan(sent.indexOf("control-9"));
  });
});
