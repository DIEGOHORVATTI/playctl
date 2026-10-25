#!/usr/bin/env bun
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

import { type Listing, playClient } from './client'
import { USAGE, parseInvocation } from './args'

type Manifest = {
  imageType: string
  languages: Record<string, { dir: string; listing?: Listing }>
  screenshots: string[]
  clearImageTypes?: string[]
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
    ...(manifest.clearImageTypes ?? []).map((imageType) => ({ language, imageType, files: [] })),
  ])
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
