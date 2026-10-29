import { type AiSuggestion, askAi, buildPrompt } from './console-ai'
import { type IarcCatalog, nextUnanswered, prunedAnswers } from './console-catalog'
import {
  type AppContent,
  DECLARATION_QUESTIONS,
  TARGET_AGE_OPTIONS,
  isMappedAge,
} from './console-forms'
import { ask, isInteractive, select } from './prompt'

type InitOptions = {
  packageName: string
  catalog: IarcCatalog
  previous?: AppContent
  ai?: string
  acceptAll: boolean
  cwd: string
}

const YES_NO = [
  { label: 'Não', value: false },
  { label: 'Sim', value: true },
]

function noteFor(reasons: Record<string, string>, key: string, fromAi: boolean) {
  const reason = reasons[key]
  return reason ? `${fromAi ? 'IA' : 'antes'}: ${reason}` : undefined
}

async function chooseBoolean(key: string, text: string, initial: boolean, note: string | undefined, prompt: boolean) {
  if (!prompt) return initial
  return select(text, YES_NO, initial ? 1 : 0, note)
}

export async function initAppContent(options: InitOptions): Promise<AppContent> {
  const { catalog, previous = {}, acceptAll } = options
  const prompt = !acceptAll
  if (prompt && !isInteractive()) throw new Error('playctl init needs a terminal, or pass --yes')

  let suggestion: AiSuggestion = { appContent: {}, iarc: {}, reasons: {} }
  if (options.ai) {
    console.log(`Asking ${options.ai} to read the project and suggest the answers...`)
    suggestion = await askAi(options.ai, buildPrompt(options.packageName, catalog), options.cwd)
  }
  const fromAi = Boolean(options.ai)
  const base = { ...previous, ...suggestion.appContent }

  const privacyPolicyUrl = prompt
    ? await ask('URL da política de privacidade', base.privacyPolicyUrl ?? '')
    : base.privacyPolicyUrl
  const email = prompt
    ? await ask('E-mail de contato da classificação de conteúdo', previous.contentRating?.email ?? '')
    : previous.contentRating?.email ?? ''

  const content: AppContent = { privacyPolicyUrl }
  for (const { key, text } of DECLARATION_QUESTIONS) {
    const value = await chooseBoolean(key, text, Boolean(base[key]), noteFor(suggestion.reasons, key, fromAi), prompt)
    content[key] = value
  }

  const initialAge = base.targetAges?.[0] ?? '18+'
  const age = prompt
    ? await select(
        'Faixa etária mais baixa do público-alvo',
        TARGET_AGE_OPTIONS.map((option) => ({
          label: option,
          value: option,
          hint: isMappedAge(option) ? undefined : 'ainda não mapeada no playctl',
        })),
        Math.max(0, TARGET_AGE_OPTIONS.indexOf(initialAge)),
        noteFor(suggestion.reasons, 'targetAges', fromAi),
      )
    : initialAge
  content.targetAges = [age]

  const suggested = { ...previous.contentRating?.answers, ...suggestion.iarc }
  let answers: Record<string, number> = {}
  for (let question = nextUnanswered(catalog, answers); question; question = nextUnanswered(catalog, answers)) {
    const initialId = suggested[String(question.id)]
    const suggestedIndex = question.answers.findIndex((answer) => answer.id === initialId)
    if (!prompt && suggestedIndex < 0) {
      throw new Error(
        `No answer for content rating question ${question.id} ("${question.text.slice(0, 80)}"). Run playctl init in a terminal to answer it.`,
      )
    }
    const initialIndex = Math.max(0, suggestedIndex)
    answers[String(question.id)] = prompt
      ? await select(
          question.text,
          question.answers.map((answer) => ({ label: answer.label, value: answer.id })),
          initialIndex,
          noteFor(suggestion.reasons, String(question.id), fromAi),
        )
      : question.answers[initialIndex]!.id
    answers = prunedAnswers(catalog, answers)
  }

  content.contentRating = { email, answers }
  return content
}
