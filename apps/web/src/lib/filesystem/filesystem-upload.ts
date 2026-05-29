import type { InputHTMLAttributes } from 'react'
import { joinClientPath } from './filesystem-paths.ts'
import type {
  FilesystemUploadChunkResponse,
  FilesystemUploadCompleteResponse,
  FilesystemUploadCreateResponse,
  FilesystemUploadItem,
} from './types.ts'

export const folderPickerAttributes = {
  webkitdirectory: '',
  directory: '',
} as InputHTMLAttributes<HTMLInputElement>

export type BrowserUploadSource =
  | { readonly type: 'file'; readonly relativePath: string; readonly file: File }
  | { readonly type: 'directory'; readonly relativePath: string }

export const FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES = 4 * 1024 * 1024

export type FilesystemBrowserUploadProgress = {
  readonly completedBytes: number
  readonly detail: string
  readonly phase: 'preparing' | 'uploading'
  readonly totalBytes: number
}

export type UploadBrowserSourcesToFilesystemOptions = {
  readonly uploadUrl: string
  readonly directoryPath: string
  readonly sources: readonly BrowserUploadSource[]
  readonly onProgress?: (progress: FilesystemBrowserUploadProgress) => void
}

type BrowserFileSystemHandle = {
  readonly kind: 'file' | 'directory'
  readonly name: string
}

type BrowserFileHandle = BrowserFileSystemHandle & {
  readonly kind: 'file'
  getFile(): Promise<File>
}

export type BrowserDirectoryHandle = BrowserFileSystemHandle & {
  readonly kind: 'directory'
  values(): AsyncIterable<BrowserFileSystemHandle>
}

export type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    readonly mode?: 'read' | 'readwrite'
  }) => Promise<BrowserDirectoryHandle>
}

function toFilesystemUploadItem(source: BrowserUploadSource): FilesystemUploadItem {
  if (source.type === 'directory') {
    return { type: 'directory', relativePath: source.relativePath }
  }
  return {
    type: 'file',
    relativePath: source.relativePath,
    size: source.file.size,
    updatedAt: Number.isFinite(source.file.lastModified)
      ? new Date(source.file.lastModified).toISOString()
      : undefined,
  }
}

export async function uploadBrowserSourcesToFilesystem({
  uploadUrl,
  directoryPath,
  sources,
  onProgress,
}: UploadBrowserSourcesToFilesystemOptions): Promise<FilesystemUploadCompleteResponse> {
  const totalBytes = sources.reduce(
    (sum, source) => sum + (source.type === 'file' ? source.file.size : 0),
    0,
  )
  const items = sources.map(toFilesystemUploadItem)
  let uploadId: string | null = null

  onProgress?.({
    detail: 'Preparing upload...',
    completedBytes: 0,
    totalBytes,
    phase: 'preparing',
  })

  try {
    const createResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: directoryPath, items }),
    })
    const createBody =
      await readJsonResponse<FilesystemUploadCreateResponse>(createResponse)
    uploadId = createBody.uploadId
    const filesByRelativePath = new Map(
      createBody.files.map((file) => [file.relativePath, file]),
    )
    let completedBytes = 0

    for (const source of sources) {
      if (source.type === 'directory') continue

      const uploadFile = filesByRelativePath.get(source.relativePath)
      if (uploadFile === undefined) {
        throw new Error(`Upload session did not include ${source.relativePath}.`)
      }

      for (
        let offset = 0;
        offset < source.file.size;
        offset += FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES
      ) {
        const chunk = source.file.slice(
          offset,
          Math.min(offset + FILESYSTEM_UPLOAD_CHUNK_SIZE_BYTES, source.file.size),
        )
        onProgress?.({
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: 'uploading',
        })
        const chunkUrl = buildUploadChunkUrl(
          uploadUrl,
          uploadId,
          uploadFile.fileId,
          offset,
        )
        const chunkResponse = await fetch(chunkUrl, {
          method: 'PATCH',
          headers: { 'content-type': 'application/octet-stream' },
          body: chunk,
        })
        await readJsonResponse<FilesystemUploadChunkResponse>(chunkResponse)
        completedBytes += chunk.size
        onProgress?.({
          detail: source.file.name,
          completedBytes,
          totalBytes,
          phase: 'uploading',
        })
      }
    }

    const completeResponse = await fetch(
      buildUploadSessionUrl(uploadUrl, uploadId),
      { method: 'POST' },
    )
    return await readJsonResponse<FilesystemUploadCompleteResponse>(completeResponse)
  } catch (error) {
    if (uploadId !== null) {
      await fetch(buildUploadSessionUrl(uploadUrl, uploadId), {
        method: 'DELETE',
      }).catch(() => undefined)
    }
    throw error
  }
}

export async function getDirectoryUploadSources(
  directoryHandle: BrowserDirectoryHandle,
): Promise<BrowserUploadSource[]> {
  const sources: BrowserUploadSource[] = [
    { type: 'directory', relativePath: directoryHandle.name },
  ]
  await appendDirectoryUploadSources(
    directoryHandle,
    directoryHandle.name,
    sources,
  )
  return sources
}

async function appendDirectoryUploadSources(
  directoryHandle: BrowserDirectoryHandle,
  relativePath: string,
  sources: BrowserUploadSource[],
): Promise<void> {
  for await (const childHandle of directoryHandle.values()) {
    const childPath = `${relativePath}/${childHandle.name}`
    if (childHandle.kind === 'directory') {
      sources.push({ type: 'directory', relativePath: childPath })
      await appendDirectoryUploadSources(
        childHandle as BrowserDirectoryHandle,
        childPath,
        sources,
      )
      continue
    }
    const file = await (childHandle as BrowserFileHandle).getFile()
    sources.push({ type: 'file', relativePath: childPath, file })
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function getBrowserRelativePath(file: File): string {
  const relativePath = (
    file as File & { readonly webkitRelativePath?: string }
  ).webkitRelativePath?.trim()
  return relativePath && relativePath.length > 0 ? relativePath : file.name
}

export function getUploadSelectionPaths(
  directoryPath: string,
  files: readonly { readonly relativePath: string }[],
): string[] {
  const selectedTopLevelPaths = new Set<string>()
  files.forEach((file) => {
    const topLevelName = file.relativePath.split('/')[0]
    if (topLevelName !== undefined && topLevelName.length > 0) {
      selectedTopLevelPaths.add(joinClientPath(directoryPath, topLevelName))
    }
  })
  return [...selectedTopLevelPaths]
}

function buildUploadSessionUrl(uploadUrl: string, uploadId: string): string {
  const url = new URL(uploadUrl)
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${encodeURIComponent(uploadId)}`
  return url.toString()
}

function buildUploadChunkUrl(
  uploadUrl: string,
  uploadId: string,
  fileId: string,
  offset: number,
): string {
  const url = new URL(buildUploadSessionUrl(uploadUrl, uploadId))
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/files/${encodeURIComponent(fileId)}`
  url.searchParams.set('offset', String(offset))
  return url.toString()
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}
