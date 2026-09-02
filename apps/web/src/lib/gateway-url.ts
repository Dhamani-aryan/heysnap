type GatewayUrlInput = {
  readonly baseUrl: string
  readonly path: string
  readonly token: string
}

const VOLATILE_GATEWAY_CONNECTION_PARAMS = new Set([
  'accessToken',
  'token',
  'path',
  'showHidden',
  'v',
])

export function buildGatewayWebsocketUrl(input: GatewayUrlInput): string {
  const url = new URL(input.path, input.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('accessToken', input.token)
  return url.toString()
}

export function buildGatewayHttpUrl(input: GatewayUrlInput): string {
  const url = new URL(input.path, input.baseUrl)
  url.searchParams.set('accessToken', input.token)
  return url.toString()
}

export function normalizeGatewayConnectionIdentity(
  rawUrl: string,
  baseUrl = getDefaultBaseUrl(),
): string {
  const url = new URL(rawUrl, baseUrl)

  for (const param of VOLATILE_GATEWAY_CONNECTION_PARAMS) {
    url.searchParams.delete(param)
  }

  sortSearchParams(url)
  url.hash = ''

  return url.toString()
}

function sortSearchParams(url: URL): void {
  const entries = Array.from(url.searchParams.entries()).sort(
    ([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue)
        : leftName.localeCompare(rightName),
  )

  url.search = ''

  for (const [name, value] of entries) {
    url.searchParams.append(name, value)
  }
}

function getDefaultBaseUrl(): string {
  if (
    typeof window !== 'undefined' &&
    typeof window.location?.href === 'string'
  ) {
    return window.location.href
  }
  return 'http://localhost'
}
