#!/usr/bin/env bun
import { dirname, join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

import { type Listing, playClient } from './client'
import { type AppContent, appContentCalls, findQuestionnaireId, iarcQuestionnaireBody, appRef } from './console-forms'
import { CONSOLE_URL, captureConsoleSession, saveSession, signInWithPlainChrome } from './console-login'
import { consoleClient, loadSession } from './console-session'
import { USAGE, parseInvocation } from './args'

type Manifest = {
  imageType: string
  languages: Record<string, { dir: string; listing?: Listing }>
  screenshots: string[]
  clearImageTypes?: string[]
  copyImageTypes?: string[]
  featureGraphic?: string
}

function readManifest(file: string) {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest
  const root = dirname(file)

  return Object.entries(manifest.languages).flatMap(([language, { dir, listing }]) => [
    {
      language,
      listing,
      imageType: manifest.imageType,
      files: manifest.screenshots.map((name) => join(root, dir, name)),
    },
    ...(manifest.featureGraphic
      ? [
          {
            language,
            imageType: 'featureGraphic',
            files: [join(root, dir, manifest.featureGraphic)],
          },
        ]
      : []),
    ...(manifest.copyImageTypes ?? []).map((imageType) => ({
      language,
      imageType,
      files: manifest.screenshots.map((name) => join(root, dir, name)),
    })),
    ...(manifest.clearImageTypes ?? []).map((imageType) => ({ language, imageType, files: [] })),
  ])
}

const COMMANDS = ['status', 'promote', 'images', 'stats', 'upload', 'details', 'datasafety', 'login', 'content']
const RELEASE_NOTES_FILE = /^whatsnew-(.+)$/

function readReleaseNotes(dir: string | undefined) {
  if (!dir) return []

  return readdirSync(dir)
    .map((file) => ({ file, language: RELEASE_NOTES_FILE.exec(file)?.[1] }))
    .filter((entry): entry is { file: string; language: string } => !!entry.language)
    .map(({ file, language }) => ({ language, text: readFileSync(join(dir, file), 'utf8').trim() }))
}

async function answerAppContent(file: string, sessionFile: string, appId: string) {
  const session = loadSession(sessionFile)
  const call = consoleClient(session)
  const ids = { developerId: session.developerId, appId }
  const content = JSON.parse(readFileSync(file, 'utf8')) as AppContent

  for (const form of appContentCalls(content, ids)) {
    process.stdout.write(`${form.name}... `)
    await call(form.path, { method: form.method, mask: form.mask, body: form.body })
    console.log('saved')
  }

  if (!content.contentRating) return
  const rating = content.contentRating
  if (rating.category !== 'other' || rating.ratedContent) {
    throw new Error('contentRating: only category "other" with ratedContent false is mapped yet')
  }

  const app = `/developers/${ids.developerId}/apps/${ids.appId}`
  process.stdout.write('content rating... ')
  await call(`${app}/contentRating:startFilledQuestionnaire`, { body: { '1': appRef(ids) } }).catch(
    (error: Error) => {
      if (!error.message.includes(' 409:')) throw error
    },
  )
  const draft = await call(`${app}/contentRating/lastFilledIarcQuestionnaire`, { method: 'GET' })
  const questionnaireId = findQuestionnaireId(draft)
  if (!questionnaireId) throw new Error('Play Console did not return the content rating questionnaire')
  const questionnaire = `${app}/contentRating/${questionnaireId}`
  await call(`${questionnaire}/filledIarcQuestionnaire`, {
    method: 'PATCH',
    mask: ['answers', 'email_address', 'language_code'],
    body: iarcQuestionnaireBody(ids, questionnaireId, rating.email),
  })
  const target = { '1': { ...appRef(ids), '3': { '1': questionnaireId } } }
  await call(`${questionnaire}:calculate`, { body: target })
  await call(`${questionnaire}:applyRating`, { body: { ...target, '2': '2' } })
  console.log('applied')
}

async function main(argv: string[]) {
  const invocation = parseInvocation(argv)
  const { command, positional, packageName, keyFile, from, to, bucket, options } = invocation

  if (!COMMANDS.includes(command ?? '')) {
    console.log(USAGE)
    return
  }

  if (command === 'login') {
    const profileDir = join(dirname(invocation.sessionFile), 'chrome-profile')
    if (!options.has('skip-sign-in')) {
      console.log('Sign in to Play Console in the Chrome window, then close that window.')
      await signInWithPlainChrome(invocation.chrome, profileDir)
    }

    const developer = options.get('developer')
    const startUrl = developer ? `${CONSOLE_URL}/u/0/developers/${developer}/app-list` : CONSOLE_URL
    const session = await captureConsoleSession(invocation.chrome, profileDir, startUrl)
    saveSession(invocation.sessionFile, session)
    console.log(`Session saved for developer account ${session.developerId} (${invocation.sessionFile})`)
    return
  }

  if (command === 'content') {
    const [file] = positional
    if (!file || !invocation.consoleAppId) {
      throw new Error(`Usage: playctl content <app-content.json> --app-id <Play Console app id>\n\n${USAGE}`)
    }

    await answerAppContent(file, invocation.sessionFile, invocation.consoleAppId)
    return
  }

  const play = await playClient({ packageName, keyFile })


  if (command === 'stats') {
    if (!bucket) throw new Error(`Missing --bucket.\n\n${USAGE}`)

    const [kind = 'installs'] = positional
    const files = await play.reportFiles(bucket, `stats/${kind}/`)
    const ours = files.filter((name) => name.includes(packageName)).sort()
    if (!ours.length) {
      console.log(`No ${kind} reports for ${packageName}. Files found:\n${files.join('\n')}`)
      return
    }

    const latestMonth = ours.at(-1)!.match(/_(\d{6})_/)?.[1]
    for (const name of ours.filter((file) => file.includes(`_${latestMonth}_`))) {
      console.log(`\n== ${name}`)
      console.log(await play.readReport(bucket, name))
    }
    return
  }

  if (command === 'upload') {
    const [file] = positional
    if (!file) throw new Error(USAGE)

    const track = options.get('track') ?? 'internal'
    const versionCode = await play.uploadBundle({
      file,
      track,
      status: options.get('status') ?? 'completed',
      name: options.get('name'),
      releaseNotes: readReleaseNotes(options.get('notes')),
    })
    console.log(`versionCode ${versionCode} released to ${track}`)
    return
  }

  if (command === 'details') {
    const details = await play.updateDetails({
      contactEmail: options.get('email'),
      contactWebsite: options.get('website'),
      contactPhone: options.get('phone'),
      defaultLanguage: options.get('language'),
    })
    console.log(JSON.stringify(details, null, 2))
    return
  }

  if (command === 'datasafety') {
    const [file] = positional
    if (!file) throw new Error(USAGE)

    await play.writeDataSafety(readFileSync(file, 'utf8'))
    console.log('Data safety form written')
    return
  }

  if (command === 'images') {
    const [manifest] = positional
    if (!manifest) throw new Error(USAGE)

    await play.replaceImages(readManifest(manifest))
    console.log('Done, the store listing is updated')
    return
  }

  if (command === 'status') {
    for (const track of await play.tracks()) {
      for (const release of track.releases ?? []) {
        const codes = release.versionCodes?.join(', ') ?? '-'
        const fraction = release.userFraction ? ` ${release.userFraction * 100}%` : ''
        console.log(
          `${track.track.padEnd(12)} ${release.status.padEnd(10)} ${codes.padEnd(6)} ${release.name ?? ''}${fraction}`,
        )
      }
    }
    return
  }

  const [versionCode] = positional
  if (!versionCode || !/^\d+$/.test(versionCode)) throw new Error(USAGE)

  const release = await play.promote(versionCode, from, to)
  console.log(`versionCode ${versionCode} (${release.name ?? ''}) moved from ${from} to ${to}`)
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
