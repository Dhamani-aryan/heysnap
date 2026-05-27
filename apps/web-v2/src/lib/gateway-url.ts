type GatewayUrlInput = {
  readonly baseUrl: string
  readonly path: string
  readonly token: string
}

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
