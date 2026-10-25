#!/usr/bin/env bun
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

import { playClient } from './client'
import { USAGE, parseInvocation } from './args'

type Manifest = {
  imageType: string
  languages: Record<string, { dir: string }>
  screenshots: string[]
}

function readManifest(file: string) {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Manifest
  const root = dirname(file)

  return Object.entries(manifest.languages).map(([language, { dir }]) => ({
    language,
    imageType: manifest.imageType,
    files: manifest.screenshots.map((name) => join(root, dir, name)),
  }))
}

async function main(argv: string[]) {
  const invocation = parseInvocation(argv)
  const { command, positional, packageName, keyFile, from, to } = invocation

  if (!['status', 'promote', 'images'].includes(command ?? '')) {
    console.log(USAGE)
    return
  }

  const play = await playClient({ packageName, keyFile })

  if (command === 'images') {
    const [manifest] = positional
    if (!manifest) throw new Error(USAGE)

    await play.replaceImages(readManifest(manifest))
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
