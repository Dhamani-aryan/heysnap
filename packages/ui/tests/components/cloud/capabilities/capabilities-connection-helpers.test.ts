import { describe, expect, it } from "vitest";

import {
  extractDeviceCode,
  extractDeviceUrl,
  normalizeTerminalText,
  parseConnectionMessages,
  stripTerminalSequences,
} from "../../../../src/components/cloud/capabilities/capabilities-connection-helpers";

describe("capabilities connection helpers", () => {
  it("extracts readonly device codes from terminal messages", () => {
    expect(extractDeviceCode("Enter ABCD-1234 to continue")).toBe("ABCD-1234");
    expect(extractDeviceCode("Use code ABCD1234 at the prompt")).toBe("ABCD1234");
    expect(extractDeviceCode("Open https://github.com/login/device?code=ABCD1234")).toBeNull();
  });

  it("extracts provider-specific device URLs", () => {
    expect(extractDeviceUrl("Open https://github.com/login/device.", "github")).toBe("https://github.com/login/device");
    expect(extractDeviceUrl("Visit https://vercel.com/device?code=ABC", "vercel")).toBe("https://vercel.com/device?code=ABC");
    expect(extractDeviceUrl("Go to https://supabase.com/dashboard/account/tokens", "supabase")).toBe("https://supabase.com/dashboard/account/tokens");
    expect(extractDeviceUrl("Visit https://example.com/device", "github")).toBeNull();
  });

  it("parses the latest connection code and URL from operation messages", () => {
    expect(parseConnectionMessages([
      "Open https://github.com/login/device",
      "Code: ABCD-1234",
      "Updated code: WXYZ-9876",
    ], "github")).toEqual({
      code: "WXYZ-9876",
      url: "https://github.com/login/device",
    });
  });

  it("strips terminal control sequences before parsing", () => {
    const raw = "\u001B[32mOpen\u001B[0m https://github.com/login/device\r\nCode: ABCD-1234\b";

    expect(stripTerminalSequences(raw)).not.toContain("\u001B");
    expect(normalizeTerminalText(raw)).toContain("Open");
    expect(parseConnectionMessages([raw], "github")).toEqual({
      code: "ABCD-1234",
      url: "https://github.com/login/device",
    });
  });
});
