import { createHash } from 'node:crypto'
import { describe, expect, it } from 'bun:test'

import { readCapturedHeaders } from './console-login'
import { consoleUrl, sapisidAuthorization } from './console-session'
import { appContentCalls, findQuestionnaireId, iarcQuestionnaireBody } from './console-forms'

const ids = { developerId: '111', appId: '222' }
const ref = { '1': { '1': '111' }, '2': { '1': '222' } }

describe('appContentCalls', () => {
  it('builds the exact bodies captured from Play Console', () => {
    const calls = appContentCalls(
      {
        privacyPolicyUrl: 'https://example.com/privacy',
        containsAds: false,
        loginRequired: false,
        usesAdvertisingId: false,
        governmentApp: false,
        financialFeatures: false,
        healthFeatures: false,
        collectsData: false,
        targetAges: ['18+'],
      },
      ids,
    )
    const byName = Object.fromEntries(calls.map((call) => [call.name, call]))

    expect(byName['privacy policy']).toMatchObject({ mask: ['url'], body: { '1': 'https://example.com/privacy' } })
    expect(byName.ads?.body).toEqual({ '1': 1 })
    expect(byName['login details']?.body).toEqual({ '1': false, '3': true })
    expect(byName.ADVERTISING_ID?.body).toEqual({
      '1': { '1': ref, '2': 6 },
      '2': [{ '1': 66, '9': { '1': false } }],
      '5': false,
    })
    expect(byName.FINANCE?.body).toMatchObject({ '2': [{ '1': 87, '6': { '1': [130] } }] })
    expect(byName.HEALTH?.body).toMatchObject({ '2': [{ '1': 185, '6': { '1': [330] } }] })
    expect(byName.PSL?.path).toBe('/developers/111/apps/222/declarations/POLICY_DECLARATION_ID_PSL')
    expect(byName['target audience']?.body).toEqual({ '1': [6], '11': true, '12': 0 })
  })

  it('refuses answers that were never captured instead of guessing', () => {
    expect(() => appContentCalls({ containsAds: true }, ids)).toThrow('not mapped yet')
    expect(() => appContentCalls({ targetAges: ['13-15'] }, ids)).toThrow('not mapped yet')
  })
})

describe('content rating', () => {
  it('sends each saved answer as the Console does', () => {
    const body = iarcQuestionnaireBody(ids, {
      questionnaireId: '1',
      version: '10.0',
      email: 'me@example.com',
      answers: { '1109': 2558, '1152': 2618 },
    })

    expect(body['1']).toEqual({ ...ref, '3': { '1': '1' } })
    expect(body['2']).toBe('10.0')
    expect(body['4']['1']).toEqual([
      { '1': 1109, '2': [2558] },
      { '1': 1152, '2': [2618] },
    ])
  })

  it('finds the questionnaire id in lastFilledIarcQuestionnaire', () => {
    const last = { '1': { '1': ref['1'], '2': ref['2'], '3': { '1': '2' } }, '2': '10.0', '4': {}, '5': 1 }
    expect(findQuestionnaireId(last)).toBe('2')
  })
})

describe('session', () => {
  it('signs SAPISIDHASH like the browser', () => {
    const auth = sapisidAuthorization([{ name: 'SAPISID', value: 'abc', domain: '.google.com' }], 1_700_000_000_000)
    const expected = createHash('sha1').update('1700000000 abc https://play.google.com').digest('hex')
    expect(auth).toBe(`SAPISIDHASH 1700000000_${expected}`)
  })

  it('sends PATCH as a method override with the update mask', () => {
    const url = consoleUrl('/developers/1/apps/2/adsDeclaration', 'PATCH', ['developer_declaration'])
    expect(decodeURIComponent(url)).toContain('$httpMethod=PATCH')
    expect(url).toContain('updateMask.paths=developer_declaration')
  })

  it('keeps the captured API headers but never the cookie or authorization', () => {
    const headers = 'X-Goog-Api-Key:key\r\nX-Goog-AuthUser:0\r\nAuthorization:SAPISIDHASH x\r\nContent-Type:application/json+protobuf'
    const url = `https://playconsoleapps-pa.clients6.google.com/v1/developers/1/x?$httpHeaders=${encodeURIComponent(headers)}`

    expect(readCapturedHeaders(url)).toEqual({
      'X-Goog-Api-Key': 'key',
      'X-Goog-AuthUser': '0',
      'Content-Type': 'application/json+protobuf',
    })
  })
})
