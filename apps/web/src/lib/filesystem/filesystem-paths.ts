export function joinClientPath(directoryPath: string, name: string): string {
  return directoryPath.length === 0 ? name : `${directoryPath}/${name}`
}

export function createInitialNavigationHistory(path: string): string[] {
  const segments = path
    .trim()
    .split('/')
    .filter((segment) => segment.length > 0)

  if (segments.length === 0) return ['']

  return [
    '',
    ...segments.map((_, index) => segments.slice(0, index + 1).join('/')),
  ]
}

export function getParentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}
