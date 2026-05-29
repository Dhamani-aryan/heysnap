import { apiRequest } from '../api-client.ts'

export type CloudUser = {
  id: string
  email: string
  username: string
  allowPiModels: boolean
  createdAt: string
  updatedAt: string
}

export type CloudSession = {
  token: string
  expiresAt: string
}

export type AuthResponse = {
  user: CloudUser
  session: CloudSession
}

export function login(input: { email: string; password: string }) {
  return apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: input,
    auth: false,
  })
}

export async function me(signal?: AbortSignal): Promise<CloudUser> {
  const response = await apiRequest<{ user: CloudUser }>('/auth/me', { signal })
  return response.user
}

export function logout() {
  return apiRequest<void>('/auth/logout', { method: 'POST' })
}
