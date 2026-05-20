import { describe, expect, it } from "vitest";

import { getClipboardAttachmentFiles } from "./prompt-composer";

const createClipboardData = ({
  files = [],
  items = [],
}: {
  readonly files?: File[];
  readonly items?: Array<Pick<DataTransferItem, "kind" | "getAsFile">>;
}): DataTransfer => ({
  files,
  items,
} as unknown as DataTransfer);

describe("getClipboardAttachmentFiles", () => {
  it("returns files exposed directly by clipboardData.files", () => {
    const screenshot = new File(["image"], "screenshot.png", { type: "image/png" });

    expect(getClipboardAttachmentFiles(createClipboardData({ files: [screenshot] }))).toEqual([screenshot]);
  });

  it("creates a filename for unnamed image clipboard item files", () => {
    const pastedImage = new File(["image"], "", { type: "image/png" });
    const files = getClipboardAttachmentFiles(createClipboardData({
      items: [
        {
          kind: "file",
          getAsFile: () => pastedImage,
        },
      ],
    }));

    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^clipboard-image-\d+-1\.png$/);
    expect(files[0]?.type).toBe("image/png");
  });

  it("ignores non-file clipboard items", () => {
    const files = getClipboardAttachmentFiles(createClipboardData({
      items: [
        {
          kind: "string",
          getAsFile: () => null,
        },
      ],
    }));

    expect(files).toEqual([]);
  });
});
