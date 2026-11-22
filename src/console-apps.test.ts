import { expect, it } from 'bun:test'

import { categoryBody, createAppBody, createdAppId, isPackageAvailable, resolveCategory } from './console-apps'

it('monta o corpo do createAppV2 como o Console envia', () => {
  expect(
    createAppBody({ developerId: '8', name: 'Scrollino', language: 'pt-BR', packageName: 'com.x.scrollino' }),
  ).toEqual({
    '1': { '1': '8' },
    '2': 'Scrollino',
    '3': 'pt-BR',
    '4': 1,
    '5': false,
    '6': true,
    '7': true,
    '9': { '1': true },
    '11': 'com.x.scrollino',
  })
})

it('recusa nome vazio ou com mais de 30 caracteres', () => {
  const base = { developerId: '8', language: 'pt-BR', packageName: 'a.b' }
  expect(() => createAppBody({ ...base, name: '' })).toThrow()
  expect(() => createAppBody({ ...base, name: 'x'.repeat(31) })).toThrow()
})

it('lê disponibilidade do pacote e o id do app criado', () => {
  expect(isPackageAvailable({ '1': 1 })).toBe(true)
  expect(isPackageAvailable({ '1': 2 })).toBe(false)
  expect(isPackageAvailable({})).toBe(false)
  expect(createdAppId({ '1': { '1': { '1': '8' }, '2': { '1': '497' } } })).toBe('497')
  expect(() => createdAppId({})).toThrow()
})

it('resolve categoria por nome ou id e monta o corpo mínimo', () => {
  expect(resolveCategory('books-and-reference')).toBe(30)
  expect(resolveCategory('12')).toBe(12)
  expect(() => resolveCategory('games')).toThrow()
  expect(categoryBody({ developerId: '8', appId: '497' }, 30)).toEqual({
    '1': { '1': { '1': '8' }, '2': { '1': '497' } },
    '3': { '1': 30 },
  })
})
