import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const API = 'https://playconsoleapps-pa.clients6.google.com/v1'
const ORIGIN = 'https://play.google.com'
const SAPISID_COOKIES: [string, string][] = [
  ['SAPISID', 'SAPISIDHASH'],
  ['__Secure-1PAPISID', 'SAPISID1PHASH'],
  ['__Secure-3PAPISID', 'SAPISID3PHASH'],
]

export type ConsoleSession = {
  capturedAt: string
  developerId: string
  headers: Record<string, string>
  cookies: { name: string; value: string; domain: string }[]
}

type CallOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  mask?: string[]
  body?: unknown
}

export function loadSession(file: string): ConsoleSession {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ConsoleSession
  } catch {
    throw new Error(`No Play Console session at ${file}. Run: playctl login`)
  }
}

export function sapisidAuthorization(cookies: ConsoleSession['cookies'], now: number) {
  const timestamp = Math.floor(now / 1000)
  const hash = (value: string) =>
    createHash('sha1').update(`${timestamp} ${value} ${ORIGIN}`).digest('hex')

  return SAPISID_COOKIES.flatMap(([cookie, scheme]) => {
    const value = cookies.find((entry) => entry.name === cookie)?.value
    return value ? [`${scheme} ${timestamp}_${hash(value)}`] : []
  }).join(' ')
}

export function consoleUrl(path: string, method: string, mask: string[] = []) {
  const params = new URLSearchParams()
  if (method === 'PATCH') params.set('$httpMethod', 'PATCH')
  for (const field of mask) params.append('updateMask.paths', field)
  const query = params.toString()

  return `${API}${path}${query ? `?${query}` : ''}`
}

export function consoleClient(session: ConsoleSession) {
  const cookieHeader = session.cookies.map(({ name, value }) => `${name}=${value}`).join('; ')

  return async function call<T>(path: string, { method = 'POST', mask, body }: CallOptions = {}) {
    const response = await fetch(consoleUrl(path, method, mask), {
      method: method === 'GET' ? 'GET' : 'POST',
      headers: {
        ...session.headers,
        'Content-Type': session.headers['Content-Type'] ?? 'application/json+protobuf',
        Authorization: sapisidAuthorization(session.cookies, Date.now()),
        Cookie: cookieHeader,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/`,
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    })
    const text = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Play Console session expired (${response.status}). Run: playctl login`)
    }
    if (!response.ok) throw new Error(`Play Console ${response.status}: ${text.slice(0, 500)}`)

    return (text ? JSON.parse(text) : {}) as T
  }
}
