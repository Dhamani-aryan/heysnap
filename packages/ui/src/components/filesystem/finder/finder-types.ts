import type { FilesystemEntry } from "../../../filesystem/types";

export type OpenFileTab = {
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly updatedAt: string;
};

export type ActiveLeftPaneSurface = "directory" | "browser" | "file";

export type SelectionRect = {
  readonly originX: number;
  readonly originY: number;
  readonly currentX: number;
  readonly currentY: number;
};

export type SelectionBox = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

export type ContextMenuState =
  | {
      readonly kind: "background";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "entry";
      readonly x: number;
      readonly y: number;
      readonly entry: FilesystemEntry;
    }
  | {
      readonly kind: "selection";
      readonly x: number;
      readonly y: number;
      readonly entries: FilesystemEntry[];
    };
