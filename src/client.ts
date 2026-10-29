import { basename } from 'node:path'
import { statSync, readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const SCOPE = [
  'https://www.googleapis.com/auth/androidpublisher',
  'https://www.googleapis.com/auth/devstorage.read_only',
].join(' ')
const STORAGE_API = 'https://storage.googleapis.com/storage/v1/b'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'
const TOKEN_TTL_SECONDS = 3600
const UPLOAD_ATTEMPTS = 4

type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri: string
}

export type Release = {
  name?: string
  status: string
  versionCodes?: string[]
  userFraction?: number
  releaseNotes?: { language: string; text: string }[]
}

export type Track = {
  track: string
  releases?: Release[]
}

export type Listing = {
  title: string
  shortDescription: string
  fullDescription: string
}

export type ImageSet = {
  language: string
  listing?: Listing
  imageType: string
  files: string[]
}

export type BundleRelease = {
  file: string
  track: string
  status: string
  name?: string
  releaseNotes: { language: string; text: string }[]
}

export type AppDetails = {
  contactEmail?: string
  contactWebsite?: string
  contactPhone?: string
  defaultLanguage?: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.aab': 'application/octet-stream',
}

export function contentTypeOf(file: string) {
  const extension = file.slice(file.lastIndexOf('.')).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

export type ClientOptions = {
  packageName: string
  keyFile: string
}

const base64Url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

function loadKey(keyFile: string): ServiceAccount {
  try {
    return JSON.parse(readFileSync(keyFile, 'utf8')) as ServiceAccount
  } catch {
    throw new Error(`Service account key not found at ${keyFile}. Pass --key or PLAY_KEY_FILE.`)
  }
}

async function accessToken(key: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    }),
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key)
  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${base64Url(signature)}`,
    }),
  })
  if (!response.ok) throw new Error(`Google login failed: ${await response.text()}`)

  return ((await response.json()) as { access_token: string }).access_token
}

export function releaseToPromote(source: Track, versionCode: string): Release {
  const found = source.releases?.find((release) => release.versionCodes?.includes(versionCode))
  if (!found) throw new Error(`versionCode ${versionCode} is not on track ${source.track}`)

  return {
    name: found.name,
    status: 'completed',
    versionCodes: [versionCode],
    releaseNotes: found.releaseNotes ?? [],
  }
}

export async function playClient({ packageName, keyFile }: ClientOptions) {
  const token = await accessToken(loadKey(keyFile))
  const appUrl = `${API}/${packageName}`

  const call = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const payload = body === undefined ? (method === 'POST' ? '{}' : null) : JSON.stringify(body)
    const response = await fetch(`${appUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(payload === null ? {} : { body: payload }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Play API ${response.status}: ${text}`)

    return (text ? JSON.parse(text) : {}) as T
  }

  const upload = async <T = unknown>(path: string, file: string, attempt = 1): Promise<T> => {
    const response = await fetch(`${UPLOAD_API}/${packageName}${path}?uploadType=media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentTypeOf(file) },
      body: readFileSync(file),
    })
    if (response.ok) return (await response.json()) as T

    const text = await response.text()
    if (response.status < 500 || attempt >= UPLOAD_ATTEMPTS) {
      throw new Error(`Play upload ${response.status}: ${text}`)
    }

    process.stdout.write(`${response.status}, retrying (${attempt}/${UPLOAD_ATTEMPTS - 1})... `)
    await Bun.sleep(attempt * 3000)
    return upload<T>(path, file, attempt + 1)
  }

  const withEdit = async <T>(work: (editId: string) => Promise<T>, commit: boolean) => {
    const { id } = await call<{ id: string }>('/edits', 'POST')

    try {
      const result = await work(id)
      if (commit) await call(`/edits/${id}:commit`, 'POST')
      else await call(`/edits/${id}`, 'DELETE')

      return result
    } catch (error) {
      await call(`/edits/${id}`, 'DELETE').catch(() => null)
      throw error
    }
  }

  const storage = async (bucket: string, path: string) => {
    const response = await fetch(`${STORAGE_API}/${bucket}/o${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error(`Cloud Storage ${response.status}: ${await response.text()}`)

    return response
  }

  return {
    reportFiles: async (bucket: string, prefix: string) => {
      const response = await storage(bucket, `?prefix=${encodeURIComponent(prefix)}`)
      const { items = [] } = (await response.json()) as { items?: { name: string }[] }

      return items.map((item) => item.name)
    },
    readReport: async (bucket: string, name: string) => {
      const response = await storage(bucket, `/${encodeURIComponent(name)}?alt=media`)

      return new TextDecoder('utf-16le').decode(await response.arrayBuffer()).replace(/^\uFEFF/, '')
    },
    uploadBundle: ({ file, track, status, name, releaseNotes }: BundleRelease) =>
      withEdit(async (id) => {
        const size = (statSync(file).size / 1024 / 1024).toFixed(1)
        process.stdout.write(`Uploading ${basename(file)} ${size} MB... `)
        const { versionCode } = await upload<{ versionCode: number }>(`/edits/${id}/bundles`, file)
        console.log(`versionCode ${versionCode}`)

        const release: Release = { name, status, versionCodes: [String(versionCode)], releaseNotes }
        await call(`/edits/${id}/tracks/${track}`, 'PUT', { track, releases: [release] })
        console.log('Committing edit, Google may take a minute...')

        return versionCode
      }, true),
    updateDetails: (details: AppDetails) =>
      withEdit((id) => call<AppDetails>(`/edits/${id}/details`, 'PATCH', details), true),
    writeDataSafety: (csv: string) => call('/dataSafety', 'POST', { safetyLabels: csv }),
    tracks: () =>
      withEdit((id) => call<{ tracks: Track[] }>(`/edits/${id}/tracks`), false).then(
        (result) => result.tracks,
      ),
    promote: (versionCode: string, from: string, to: string) =>
      withEdit(async (id) => {
        const source = await call<Track>(`/edits/${id}/tracks/${from}`)
        const release = releaseToPromote(source, versionCode)

        await call(`/edits/${id}/tracks/${to}`, 'PUT', { track: to, releases: [release] })

        return release
      }, true),
    replaceImages: (sets: ImageSet[]) =>
      withEdit(async (id) => {
        const total = sets.reduce((sum, set) => sum + set.files.length, 0)
        let done = 0

        for (const { language, listing, imageType, files } of sets) {
          if (listing) {
            console.log(`${language}: writing store listing "${listing.title}"`)
            await call(`/edits/${id}/listings/${language}`, 'PUT', { language, ...listing })
          }

          const path = `/edits/${id}/listings/${language}/${imageType}`
          console.log(`${language}: removing current ${imageType}`)
          await call(path, 'DELETE')

          for (const file of files) {
            const started = Date.now()
            const size = (statSync(file).size / 1024 / 1024).toFixed(1)
            process.stdout.write(
              `  [${done + 1}/${total}] ${language} ${basename(file)} ${size} MB... `,
            )
            await upload(path, file)
            done++
            console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`)
          }
        }

        console.log('Committing edit, Google may take a minute...')
      }, true),
  }
}
