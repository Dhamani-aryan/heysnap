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
  readonly data: string;
  readonly assetBaseUrl?: string;
};

export type PreviewWorkbook = {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
  readonly data: string;
  readonly workbook: unknown;
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

export type PreviewServerMessage =
  | ({ readonly type: "file" } & PreviewFile)
  | ({ readonly type: "workbook" } & PreviewWorkbook)
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
