export type PreviewClientMessage =
  | {
      readonly type: "watch";
      readonly path: string;
      readonly root?: string;
      readonly publicBasePath?: string;
    }
  | {
      readonly type: "ping";
      readonly requestId?: string;
    };

export type PreviewFile = {
  readonly path: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly mtime: number;
  readonly data?: string;
  readonly assetBaseUrl?: string;
  readonly sourceUrl?: string;
  readonly downloadUrl?: string;
};

export type PreviewWorkbook = {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly version: number;
  readonly data?: string;
  readonly downloadUrl?: string;
  readonly change?: PreviewWorkbookChange;
  readonly workbook: unknown;
};

export type PreviewWorkbookChange = {
  readonly type: "initial" | "full" | "patch";
  readonly version: number;
  readonly changedCells?: readonly PreviewWorkbookChangedCells[];
  readonly replacedSheets?: readonly PreviewWorkbookChangedSheet[];
  readonly stylesChanged?: boolean;
};

export type PreviewWorkbookChangedCells = {
  readonly sheetKey: string;
  readonly sheetIndex: number;
  readonly addresses: readonly string[];
};

export type PreviewWorkbookChangedSheet = {
  readonly sheetKey: string;
  readonly sheetIndex: number;
};

export type PreviewWorkbookPatch =
  readonly PreviewWorkbookPatchOperation[];

export type PreviewWorkbookPatchOperation =
  | {
      readonly kind: "cells";
      readonly sheetKey: string;
      readonly sheetIndex: number;
      readonly cells: Readonly<Record<string, unknown | null>>;
    }
  | {
      readonly kind: "replaceSheet";
      readonly sheetKey: string;
      readonly sheetIndex: number;
      readonly sheet: unknown;
    }
  | {
      readonly kind: "replaceSheets";
      readonly sheets: readonly unknown[];
    }
  | {
      readonly kind: "replaceStyles";
      readonly styles: unknown | null;
    };

export type PreviewHtmlChange =
  | { readonly type: "initial" }
  | {
      readonly type: "add" | "change" | "unlink";
      readonly path: string;
      readonly isEntry: boolean;
    };

export type PreviewHtml = {
  readonly path: string;
  readonly name: string;
  readonly mtime: number;
  readonly url: string;
  readonly change?: PreviewHtmlChange;
};

export type PreviewWorkbookPatchMessage = {
  readonly type: "workbookPatch";
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly version: number;
  readonly baseVersion: number;
  readonly downloadUrl: string;
  readonly patch: PreviewWorkbookPatch;
  readonly change: PreviewWorkbookChange;
};

export type PreviewServerMessage =
  | ({ readonly type: "file" } & PreviewFile)
  | ({ readonly type: "workbook" } & PreviewWorkbook)
  | PreviewWorkbookPatchMessage
  | ({ readonly type: "htmlPreview" } & PreviewHtml)
  | {
      readonly type: "error";
      readonly message: string;
    }
  | {
      readonly type: "pong";
      readonly requestId?: string;
      readonly serverTime: string;
    };

export type PreviewItem =
  | { readonly kind: "file"; readonly file: PreviewFile }
  | { readonly kind: "workbook"; readonly data: PreviewWorkbook }
  | { readonly kind: "html"; readonly data: PreviewHtml };
