import { appendFileSync } from 'node:fs'

import type { ConsoleSession } from './console-session'
import {
  consoleApiRequest,
  launchWithDevtools,
  readSessionCookies,
  type DevtoolsEvent,
} from './console-login'

const CONSOLE_HOST = /^https:\/\/playconsole[a-z]+-pa\.clients6\.google\.com\//
const MAX_BODY = 20_000

export type CapturedCall = {
  at: string
  method: string
  httpMethod: string
  path: string
  query: Record<string, string[]>
  requestBody?: unknown
  status?: number
  responseBody?: unknown
}

function parseJson(text: string | undefined) {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text.slice(0, MAX_BODY)
  }
}

export function describeConsoleUrl(url: string) {
  const parsed = new URL(url)
  const query: Record<string, string[]> = {}
  for (const [name, value] of parsed.searchParams) {
    if (name === '$httpHeaders' || name === 'key') continue
    query[name] = [...(query[name] ?? []), value]
  }
  return { path: parsed.pathname.replace(/^\/v1/, ''), query }
}

type Pending = Omit<CapturedCall, 'status' | 'responseBody'>

export async function captureConsoleCalls(
  chrome: string,
  profileDir: string,
  startUrl: string,
  outFile: string,
  onSession: (session: ConsoleSession) => void,
) {
  const devtools = await launchWithDevtools(chrome, profileDir, startUrl)
  const pending = new Map<string, Pending>()
  const statuses = new Map<string, number>()
  let sessionSaved = false

  async function record(event: DevtoolsEvent) {
    const params = event.params
    const requestId = params?.requestId
    if (!requestId) return

    if (event.method === 'Network.requestWillBeSent' && params.request) {
      const { url, method = 'GET', postData, hasPostData } = params.request
      if (!CONSOLE_HOST.test(url)) return
      const body =
        postData ??
        (hasPostData
          ? (await devtools.send<{ result?: { postData?: string } }>('Network.getRequestPostData', { requestId }))
              .result?.postData
          : undefined)
      const { path, query } = describeConsoleUrl(url)
      pending.set(requestId, {
        at: new Date().toISOString(),
        method,
        httpMethod: query.$httpMethod?.[0] ?? method,
        path,
        query,
        requestBody: parseJson(body),
      })

      const session = consoleApiRequest(url)
      if (!sessionSaved && session && Object.keys(session.headers).length) {
        sessionSaved = true
        onSession({
          capturedAt: new Date().toISOString(),
          ...session,
          cookies: await readSessionCookies(devtools.send),
        })
      }
      return
    }

    if (event.method === 'Network.responseReceived' && params.response) {
      statuses.set(requestId, params.response.status)
      return
    }

    if (event.method === 'Network.loadingFinished' && pending.has(requestId)) {
      const call = pending.get(requestId)!
      pending.delete(requestId)
      const { result } = await devtools.send<{ result?: { body?: string } }>('Network.getResponseBody', {
        requestId,
      })
      const captured: CapturedCall = {
        ...call,
        status: statuses.get(requestId),
        responseBody: parseJson(result?.body),
      }
      appendFileSync(outFile, `${JSON.stringify(captured)}\n`)
      console.log(`${captured.status ?? '...'} ${captured.httpMethod.padEnd(6)} ${captured.path}`)
    }
  }

  devtools.onEvent((event) => {
    void record(event).catch(() => null)
  })
  await devtools.send('Network.enable', { maxPostDataSize: 1_000_000 })
  await devtools.closed
}
