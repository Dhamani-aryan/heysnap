export function joinClientPath(directoryPath: string, name: string): string {
  return directoryPath.length === 0 ? name : `${directoryPath}/${name}`
}

export function getParentPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}
