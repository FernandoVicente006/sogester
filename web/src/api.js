const TOKEN_KEY = 'sogester.token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn)

export async function api(method, path, { body, headers, form } = {}) {
  const token = getToken()
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = data?.error ?? {}
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Erro inesperado', err.details)
  }
  return data
}

export const errorText = (err) =>
  err?.details?.length
    ? `${err.message}: ${err.details.map((d) => `${d.field} ${d.message}`).join('; ')}`
    : (err?.message ?? 'Erro')
