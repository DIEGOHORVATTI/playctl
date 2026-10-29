import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import type { ConsoleSession } from './console-session'

export const CONSOLE_URL = 'https://play.google.com/console'
const CONSOLE_API = /https:\/\/playconsole[a-z]+-pa\.clients6\.google\.com\/v1\/developers\/(\d+)\//
const COOKIE_URLS = ['https://play.google.com', 'https://google.com', 'https://accounts.google.com']
const DROPPED_HEADERS = new Set(['authorization', 'cookie'])
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

type CdpMessage = {
  id?: number
  method?: string
  params?: { request?: { url: string }; frame?: { url: string; parentId?: string } }
  result?: { cookies?: { name: string; value: string; domain: string }[] }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function readCapturedHeaders(url: string) {
  const raw = new URL(url).searchParams.get('$httpHeaders') ?? ''
  const headers: Record<string, string> = {}

  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const name = line.slice(0, separator).trim()
    if (!DROPPED_HEADERS.has(name.toLowerCase())) headers[name] = line.slice(separator + 1).trim()
  }

  return headers
}

async function waitForDevtoolsPort(profileDir: string) {
  const portFile = `${profileDir}/DevToolsActivePort`
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(portFile)) return readFileSync(portFile, 'utf8').split('\n')[0]!
    await sleep(200)
  }
  throw new Error('Chrome did not open its DevTools port')
}

async function pageWebSocket(port: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string
      webSocketDebuggerUrl: string
    }[]
    const page = targets.find((target) => target.type === 'page')
    if (page) return page.webSocketDebuggerUrl
    await sleep(200)
  }
  throw new Error('Chrome did not open a page')
}

const BASE_FLAGS = ['--no-first-run', '--no-default-browser-check']

export function signInWithPlainChrome(chrome: string, profileDir: string) {
  mkdirSync(profileDir, { recursive: true })
  const browser = spawn(chrome, [`--user-data-dir=${profileDir}`, ...BASE_FLAGS, CONSOLE_URL], {
    stdio: 'ignore',
  })

  return new Promise<void>((resolve) => browser.on('exit', () => resolve()))
}

export async function captureConsoleSession(chrome: string, profileDir: string, startUrl: string) {
  mkdirSync(profileDir, { recursive: true })
  rmSync(`${profileDir}/DevToolsActivePort`, { force: true })
  const browser = spawn(
    chrome,
    [`--user-data-dir=${profileDir}`, '--remote-debugging-port=0', ...BASE_FLAGS, startUrl],
    { stdio: 'ignore' },
  )

  const socket = new WebSocket(await pageWebSocket(await waitForDevtoolsPort(profileDir)))
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))

  let nextId = 0
  const pending = new Map<number, (message: CdpMessage) => void>()
  const send = (method: string, params: object = {}) =>
    new Promise<CdpMessage>((resolve) => {
      const id = ++nextId
      pending.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params }))
    })

  const captured = new Promise<{ developerId: string; headers: Record<string, string> }>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Login timed out')), LOGIN_TIMEOUT_MS)
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as CdpMessage
        if (message.id) return pending.get(message.id)?.(message)

        const frame = message.params?.frame
        if (message.method === 'Page.frameNavigated' && frame && !frame.parentId) {
          console.log(`  at ${new URL(frame.url).host}${new URL(frame.url).pathname.slice(0, 40)}`)
        }

        const url = message.params?.request?.url ?? ''
        const developerId = CONSOLE_API.exec(url)?.[1]
        const headers = developerId ? readCapturedHeaders(url) : {}
        if (developerId && Object.keys(headers).length) {
          clearTimeout(timer)
          resolve({ developerId, headers })
        }
      })
    },
  )

  await send('Network.enable')
  await send('Page.enable')
  console.log('Reading the session (pick your developer account if Play Console asks)...')
  const { developerId, headers } = await captured

  const { result } = await send('Network.getCookies', { urls: COOKIE_URLS })
  const session: ConsoleSession = {
    capturedAt: new Date().toISOString(),
    developerId,
    headers,
    cookies: (result?.cookies ?? []).map(({ name, value, domain }) => ({ name, value, domain })),
  }

  await send('Browser.close').catch(() => null)
  socket.close()
  browser.kill()

  return session
}

export function saveSession(file: string, session: ConsoleSession) {
  mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true })
  writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 })
}
