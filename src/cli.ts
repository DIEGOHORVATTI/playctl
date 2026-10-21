#!/usr/bin/env bun
import { playClient } from './client'
import { USAGE, parseInvocation } from './args'

async function main(argv: string[]) {
  const invocation = parseInvocation(argv)
  const { command, positional, packageName, keyFile, from, to } = invocation

  if (command !== 'status' && command !== 'promote') {
    console.log(USAGE)
    return
  }

  const play = await playClient({ packageName, keyFile })

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
