import { it, expect, describe } from 'bun:test'

import { parseInvocation } from './args'
import { contentTypeOf, releaseToPromote } from './client'

const environment = { cwd: '/tmp/nowhere', env: {}, home: '/home/me' }

describe('parseInvocation', () => {
  it('promote goes from alpha to production by default', () => {
    const invocation = parseInvocation(['promote', '18', '--package', 'com.app'], environment)

    expect(invocation).toEqual({
      command: 'promote',
      positional: ['18'],
      packageName: 'com.app',
      keyFile: '/home/me/.config/playctl/key.json',
      from: 'alpha',
      to: 'production',
      bucket: '',
      options: new Map([['package', 'com.app']]),
      consoleAppId: '',
      sessionFile: '/home/me/.config/playctl/console-session.json',
      chrome: 'google-chrome',
      configFile: '/tmp/nowhere/.playctl.json',
    })
  })

  it('keeps extra flags for upload and details', () => {
    const invocation = parseInvocation(
      ['upload', 'app.aab', '--track', 'internal', '--status', 'draft', '--package', 'com.app'],
      environment,
    )

    expect(invocation.positional).toEqual(['app.aab'])
    expect(invocation.options.get('track')).toBe('internal')
    expect(invocation.options.get('status')).toBe('draft')
  })

  it('reads package and key from the environment and expands ~', () => {
    const invocation = parseInvocation(['status'], {
      ...environment,
      env: { PLAY_PACKAGE_NAME: 'com.env', PLAY_KEY_FILE: '~/keys/play.json' },
    })

    expect(invocation.packageName).toBe('com.env')
    expect(invocation.keyFile).toBe('/home/me/keys/play.json')
  })

  it('refuses a command without package', () => {
    expect(() => parseInvocation(['status'], environment)).toThrow()
  })
})

describe('releaseToPromote', () => {
  it('copies name and release notes and publishes it complete', () => {
    const release = releaseToPromote(
      {
        track: 'alpha',
        releases: [
          {
            name: '1.14.0',
            status: 'completed',
            versionCodes: ['18'],
            releaseNotes: [{ language: 'en-US', text: 'News' }],
          },
        ],
      },
      '18',
    )

    expect(release).toEqual({
      name: '1.14.0',
      status: 'completed',
      versionCodes: ['18'],
      releaseNotes: [{ language: 'en-US', text: 'News' }],
    })
  })

  it('fails when the versionCode is not on the source track', () => {
    expect(() => releaseToPromote({ track: 'alpha', releases: [] }, '18')).toThrow()
  })
})

describe('contentTypeOf', () => {
  it('sends JPEG screenshots as JPEG and bundles as binary', () => {
    expect(contentTypeOf('store/1-map.jpg')).toBe('image/jpeg')
    expect(contentTypeOf('feature.PNG')).toBe('image/png')
    expect(contentTypeOf('app-release.aab')).toBe('application/octet-stream')
  })
})
