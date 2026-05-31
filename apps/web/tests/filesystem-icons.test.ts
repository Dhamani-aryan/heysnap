import { describe, expect, it } from 'vitest'
import {
  FILESYSTEM_FILE_ICON_SRC,
  FILESYSTEM_FOLDER_ICON_SRC,
  getFilesystemEntryIconSize,
  getFilesystemEntryIconSrc,
  getFilesystemFileTypeIconSrc,
} from '../src/lib/filesystem/filesystem-icons.ts'
import type { FilesystemEntry } from '../src/lib/filesystem/types.ts'

const entry = (
  name: string,
  type: FilesystemEntry['type'] = 'file',
): FilesystemEntry => ({
  name,
  path: name,
  type,
  size: type === 'file' ? 10 : null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  isHidden: false,
  isSymlink: false,
})

describe('filesystem icons', () => {
  it.each([
    ['budget.csv', '/filesystem/csv_icon.png'],
    ['brief.docx', '/filesystem/docx_icon.png'],
    ['paper.pdf', '/filesystem/pdf_icon.png'],
    ['deck.pptx', '/filesystem/pptx_icon.png'],
    ['model.xlsx', '/filesystem/xlsx_icon.png'],
  ])('resolves the %s file type icon', (fileName, expectedSrc) => {
    expect(getFilesystemFileTypeIconSrc(fileName)).toBe(expectedSrc)
  })

  it('matches supported extensions case-insensitively', () => {
    expect(getFilesystemFileTypeIconSrc('Report.FINAL.PDF')).toBe(
      '/filesystem/pdf_icon.png',
    )
  })

  it('falls back to the general file image for unsupported files', () => {
    expect(getFilesystemFileTypeIconSrc('notes.txt')).toBeNull()
    expect(getFilesystemEntryIconSrc(entry('notes.txt'))).toBe(
      FILESYSTEM_FILE_ICON_SRC,
    )
  })

  it('keeps directories on the folder image', () => {
    expect(getFilesystemEntryIconSrc(entry('Documents', 'directory'))).toBe(
      FILESYSTEM_FOLDER_ICON_SRC,
    )
  })

  it('renders typed file icons at the same height as the generic file image', () => {
    expect(getFilesystemEntryIconSize(entry('notes.txt'))).toEqual({
      width: 39,
      height: 52,
    })
    expect(getFilesystemEntryIconSize(entry('brief.docx'))).toEqual({
      width: 52,
      height: 52,
    })
  })
})
