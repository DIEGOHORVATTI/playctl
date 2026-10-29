import { expect, it } from 'bun:test'

import { type IarcCatalog, nextUnanswered, prunedAnswers, visibleQuestions } from './console-catalog'
import { parseSuggestion } from './console-ai'

const yesNo = (yes: number, no: number) => [
  { '1': yes, '2': 'Yes', '3': { '2': 'Sim' } },
  { '1': no, '2': 'No', '3': { '2': 'Não' } },
]

const catalog: IarcCatalog = {
  '4': '10.0',
  '2': [
    { '1': 1, '4': 1, '5': 'AppType', '9': [{ '1': 10, '2': 'Game', '6': 'Jogo' }, { '1': 11, '2': 'Other', '6': 'Outros' }] },
    { '1': 2, '4': 2, '5': 'Violence', '11': 'Tem violência?', '9': yesNo(20, 21) },
    { '1': 3, '4': 3, '5': 'Gore', '11': 'É explícita?', '9': yesNo(30, 31) },
    { '1': 4, '4': 2, '5': 'Downloaded', '11': 'Conteúdo baixado?', '9': yesNo(40, 41) },
  ],
  '3': [
    { '1': [10], '2': [2] },
    { '1': [20], '2': [3] },
    { '1': [11], '2': [4] },
  ],
}

it('starts at the root and follows the answers', () => {
  expect(nextUnanswered(catalog, {})?.id).toBe(1)
  expect(nextUnanswered(catalog, { '1': 11 })?.text).toBe('Conteúdo baixado?')
  expect(nextUnanswered(catalog, { '1': 10, '2': 20 })?.id).toBe(3)
  expect(nextUnanswered(catalog, { '1': 10, '2': 21 })).toBeUndefined()
})

it('labels answers with the Console text', () => {
  expect(visibleQuestions(catalog, {})[0]?.answers.map((answer) => answer.label)).toEqual(['Jogo', 'Outros'])
})

it('drops answers of questions that are no longer shown', () => {
  expect(prunedAnswers(catalog, { '1': 11, '2': 20, '3': 30, '4': 41 })).toEqual({ '1': 11, '4': 41 })
})

it('reads the AI answer with or without a code fence', () => {
  const json = '{"appContent":{"containsAds":false},"iarc":{"1":11},"reasons":{"1":"utility"}}'
  expect(parseSuggestion(`Here:\n\`\`\`json\n${json}\n\`\`\``).iarc).toEqual({ '1': 11 })
  expect(parseSuggestion(`noise ${json} end`).reasons).toEqual({ '1': 'utility' })
})

it('refuses to pick an answer on its own when one is missing', async () => {
  const { initAppContent } = await import('./console-init')
  const run = initAppContent({ packageName: 'x', catalog, acceptAll: true, cwd: '.', previous: { contentRating: { email: 'a@b.c', answers: { '1': 11 } } } })
  await expect(run).rejects.toThrow('No answer for content rating question 4')
})
