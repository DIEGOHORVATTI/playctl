import { expect, it } from 'bun:test'

import { describeConsoleUrl } from './console-capture'

it('tira chave e headers da URL capturada e mantém o método e a máscara', () => {
  const url =
    'https://playconsoleapps-pa.clients6.google.com/v1/developers/1/apps/2/privacyPolicy?%24httpMethod=PATCH&updateMask.paths=url&key=SECRET&%24httpHeaders=Authorization%3Ax'
  expect(describeConsoleUrl(url)).toEqual({
    path: '/developers/1/apps/2/privacyPolicy',
    query: { $httpMethod: ['PATCH'], 'updateMask.paths': ['url'] },
  })
})
