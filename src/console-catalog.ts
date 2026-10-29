export type IarcAnswer = {
  '1': number
  '2': string
  '3'?: { '2'?: string }
  '6'?: string
}

export type IarcQuestion = {
  '1': number
  '4': number
  '5': string
  '9'?: IarcAnswer[]
  '11'?: string
}

export type IarcCatalog = {
  '2': IarcQuestion[]
  '3': { '1': number[]; '2': number[] }[]
  '4': string
}

export type CatalogQuestion = {
  id: number
  text: string
  answers: { id: number; label: string; code: string }[]
}

export type IarcAnswers = Record<string, number>

export function answerLabel(answer: IarcAnswer) {
  return answer['6'] ?? answer['3']?.['2'] ?? answer['2']
}

export function toCatalogQuestion(question: IarcQuestion): CatalogQuestion {
  return {
    id: question['1'],
    text: (question['11'] ?? question['5']).trim(),
    answers: (question['9'] ?? []).map((answer) => ({
      id: answer['1'],
      label: answerLabel(answer),
      code: answer['2'],
    })),
  }
}

export function visibleQuestions(catalog: IarcCatalog, answers: IarcAnswers): CatalogQuestion[] {
  const revealedBy = new Map<number, number[]>()
  for (const rule of catalog['3']) {
    for (const questionId of rule['2']) revealedBy.set(questionId, rule['1'])
  }

  const chosen = new Set(Object.values(answers))
  const isVisible = (question: IarcQuestion) => {
    const triggers = revealedBy.get(question['1'])
    return !triggers || triggers.some((answerId) => chosen.has(answerId))
  }

  return catalog['2']
    .filter(isVisible)
    .sort((a, b) => a['4'] - b['4'])
    .map(toCatalogQuestion)
}

export function nextUnanswered(catalog: IarcCatalog, answers: IarcAnswers) {
  return visibleQuestions(catalog, answers).find((question) => !(String(question.id) in answers))
}

export function prunedAnswers(catalog: IarcCatalog, answers: IarcAnswers): IarcAnswers {
  let current = answers
  for (;;) {
    const visible = new Set(visibleQuestions(catalog, current).map((question) => String(question.id)))
    const kept = Object.fromEntries(Object.entries(current).filter(([id]) => visible.has(id)))
    if (Object.keys(kept).length === Object.keys(current).length) return kept
    current = kept
  }
}
