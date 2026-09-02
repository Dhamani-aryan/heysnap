import type { FilesystemEntry } from './types.ts'

export const FILESYSTEM_FOLDER_ICON_SRC = '/filesystem/Folder.png'
export const FILESYSTEM_FILE_ICON_SRC = '/filesystem/File.png'

export type FilesystemEntryIconSize = {
  readonly width: number
  readonly height: number
}

const FILE_ICON_SRC_BY_EXTENSION = {
  csv: '/filesystem/csv_icon.png',
  docx: '/filesystem/docx_icon.png',
  pdf: '/filesystem/pdf_icon.png',
  pptx: '/filesystem/pptx_icon.png',
  xlsx: '/filesystem/xlsx_icon.png',
} as const satisfies Record<string, string>

const FOLDER_ICON_SIZE = { width: 60, height: 52 } as const
const GENERIC_FILE_ICON_SIZE = { width: 39, height: 52 } as const
const TYPED_FILE_ICON_SIZE = { width: 52, height: 52 } as const

type FilesystemFileTypeExtension = keyof typeof FILE_ICON_SRC_BY_EXTENSION

export function getFilesystemFileTypeIconSrc(
  fileName: string,
): string | null {
  const extension = getFileExtension(fileName)
  if (extension === null || !isFilesystemFileTypeExtension(extension)) {
    return null
  }
  return FILE_ICON_SRC_BY_EXTENSION[extension]
}

export function getFilesystemEntryIconSrc(entry: FilesystemEntry): string {
  if (entry.type === 'directory') return FILESYSTEM_FOLDER_ICON_SRC
  return getFilesystemFileTypeIconSrc(entry.name) ?? FILESYSTEM_FILE_ICON_SRC
}

export function getFilesystemEntryIconSize(
  entry: FilesystemEntry,
): FilesystemEntryIconSize {
  if (entry.type === 'directory') return FOLDER_ICON_SIZE
  return getFilesystemFileTypeIconSrc(entry.name) === null
    ? GENERIC_FILE_ICON_SIZE
    : TYPED_FILE_ICON_SIZE
}

function getFileExtension(fileName: string): string | null {
  const lastSegment = fileName.split('/').at(-1) ?? fileName
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null
  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

function isFilesystemFileTypeExtension(
  extension: string,
): extension is FilesystemFileTypeExtension {
  return extension in FILE_ICON_SRC_BY_EXTENSION
}
