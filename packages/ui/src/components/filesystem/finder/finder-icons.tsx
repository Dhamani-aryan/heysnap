import type { ReactElement, ReactNode } from "react";

import docxFileIconSrc from "../../../../../../apps/assets/files/docx_file_icon.png";
import pdfFileIconSrc from "../../../../../../apps/assets/files/pdf_file_icon.png";
import xlsxFileIconSrc from "../../../../../../apps/assets/files/xlsx_file_icon.png";
import fileIconSrc from "../../../filesystem/assets/macos/File.png";
import folderIconSrc from "../../../filesystem/assets/macos/Folder.png";
import type { FilesystemEntry } from "../../../filesystem/types";

export const ChevronIcon = ({
  direction,
}: {
  readonly direction: "left" | "right";
}): ReactElement => {
  const rotate = direction === "left" ? 90 : -90;

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const Spinner = (): ReactElement => (
  <span className="spinner" role="status" aria-label="Loading" />
);

export const EntryIcon = ({
  entry,
  size = 52,
}: {
  readonly entry: FilesystemEntry;
  readonly size?: number;
}): ReactElement => {
  const typedFileIconSrc = entry.type === "file" ? getTypedFileIconSrc(entry.name) : null;
  const src = getAssetSrc(entry.type === "directory" ? folderIconSrc : typedFileIconSrc ?? fileIconSrc);

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="entry-icon"
      style={{
        width: entry.type === "directory" ? 1.15 * size : 0.75 * size,
        height: size,
      }}
    />
  );
};

export const getTypedFileIconSrc = (fileName: string): string | null => {
  if (isPdfFile(fileName)) {
    return getAssetSrc(pdfFileIconSrc);
  }

  if (isDocxFile(fileName)) {
    return getAssetSrc(docxFileIconSrc);
  }

  if (isSpreadsheetFile(fileName)) {
    return getAssetSrc(xlsxFileIconSrc);
  }

  return null;
};

const getAssetSrc = (asset: unknown): string => {
  if (typeof asset === "string") {
    return asset;
  }

  if (
    typeof asset === "object" &&
    asset !== null &&
    "src" in asset &&
    typeof (asset as { readonly src: unknown }).src === "string"
  ) {
    return (asset as { readonly src: string }).src;
  }

  return "";
};

const isPdfFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".pdf");

const isDocxFile = (fileName: string): boolean =>
  fileName.toLowerCase().endsWith(".docx");

const isSpreadsheetFile = (fileName: string): boolean =>
  /\.(xls|xlsx)$/iu.test(fileName);

const IconPath = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    {children}
  </svg>
);

export const ViewIcon = (): ReactElement => (
  <IconPath>
    <path
      d="M3.5 12s3-5.5 8.5-5.5S20.5 12 20.5 12s-3 5.5-8.5 5.5S3.5 12 3.5 12Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" strokeWidth="1.7" />
  </IconPath>
);

export const RenameIcon = (): ReactElement => (
  <IconPath>
    <path d="M4 17.5h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path
      d="M5 15.5 15.7 4.8a2.1 2.1 0 0 1 3 3L8 18.5l-4 .9 1-3.9Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </IconPath>
);

export const TrashIcon = (): ReactElement => (
  <IconPath>
    <path d="M5 7h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7 7.5 8 19a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8l1-11.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M10.5 11v5.5M13.5 11v5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </IconPath>
);

export const InfoIcon = (): ReactElement => (
  <IconPath>
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12 8h.01" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </IconPath>
);

export const CloseIcon = (): ReactElement => (
  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
);
