export type AppContent = {
  privacyPolicyUrl?: string
  containsAds?: boolean
  loginRequired?: boolean
  usesAdvertisingId?: boolean
  governmentApp?: boolean
  financialFeatures?: boolean
  healthFeatures?: boolean
  collectsData?: boolean
  targetAges?: string[]
  contentRating?: { email: string; answers: Record<string, number> }
}

export type DeclarationKey =
  | 'containsAds'
  | 'loginRequired'
  | 'usesAdvertisingId'
  | 'governmentApp'
  | 'financialFeatures'
  | 'healthFeatures'
  | 'collectsData'

export const DECLARATION_QUESTIONS: { key: DeclarationKey; text: string }[] = [
  { key: 'containsAds', text: 'O app mostra anúncios (inclusive de SDKs de terceiros)?' },
  { key: 'loginRequired', text: 'Alguma parte do app exige login, assinatura ou código para acessar?' },
  { key: 'usesAdvertisingId', text: 'O app (ou um SDK dele) usa o ID de publicidade?' },
  { key: 'governmentApp', text: 'O app foi feito por ou em nome de um governo?' },
  { key: 'financialFeatures', text: 'O app oferece funcionalidades financeiras (pagamentos, empréstimos, investimentos...)?' },
  { key: 'healthFeatures', text: 'O app tem funcionalidades de saúde (fitness, medicina, bem-estar...)?' },
  { key: 'collectsData', text: 'O app coleta ou compartilha dados do usuário fora do aparelho?' },
]

export const TARGET_AGE_OPTIONS = ['18+', '16-17', '13-15', '9-12', '6-8', '0-5']

export function isMappedAge(age: string) {
  return age in TARGET_AGE_BANDS
}

type AppIds = { developerId: string; appId: string }

export type FormCall = {
  name: string
  path: string
  method: 'POST' | 'PATCH'
  mask?: string[]
  body: unknown
}

const NO_ADS = 1
const TARGET_AGE_BANDS: Record<string, number> = { '18+': 6 }

const POLICY_DECLARATIONS = {
  usesAdvertisingId: { id: 'ADVERTISING_ID', type: 6, question: 66 },
  governmentApp: { id: 'GOVERNMENT_APPS', type: 10, question: 78 },
  collectsData: { id: 'PSL', type: 3, question: 5 },
} as const

const NONE_OF_THESE = {
  financialFeatures: { id: 'FINANCE', type: 20, question: 87, none: 130 },
  healthFeatures: { id: 'HEALTH', type: 26, question: 185, none: 330 },
} as const

const IARC_QUESTIONNAIRE_TYPE = 1

export function appRef({ developerId, appId }: AppIds) {
  return { '1': { '1': developerId }, '2': { '1': appId } }
}

function unsupported(field: string, value: unknown): never {
  throw new Error(
    `${field}: ${JSON.stringify(value)} is not mapped yet. Answer it once in Play Console and capture the call (docs/console-api.md).`,
  )
}

function policyDeclaration(ids: AppIds, id: string, type: number, answer: object): FormCall {
  return {
    name: id,
    path: `/developers/${ids.developerId}/apps/${ids.appId}/declarations/POLICY_DECLARATION_ID_${id}`,
    method: 'PATCH',
    body: { '1': { '1': appRef(ids), '2': type }, '2': [answer], '5': false },
  }
}

export function appContentCalls(content: AppContent, ids: AppIds): FormCall[] {
  const app = `/developers/${ids.developerId}/apps/${ids.appId}`
  const calls: FormCall[] = []

  if (content.privacyPolicyUrl) {
    calls.push({
      name: 'privacy policy',
      path: `${app}/privacyPolicy`,
      method: 'PATCH',
      mask: ['url'],
      body: { '1': content.privacyPolicyUrl },
    })
  }

  if (content.containsAds !== undefined) {
    if (content.containsAds) unsupported('containsAds', true)
    calls.push({
      name: 'ads',
      path: `${app}/adsDeclaration`,
      method: 'PATCH',
      mask: ['developer_declaration'],
      body: { '1': NO_ADS },
    })
  }

  if (content.loginRequired !== undefined) {
    if (content.loginRequired) unsupported('loginRequired', true)
    calls.push({
      name: 'login details',
      path: `${app}/testingCredentials`,
      method: 'PATCH',
      mask: ['android_testing_consent', 'credentials', 'login_required'],
      body: { '1': false, '3': true },
    })
  }

  for (const [field, { id, type, question }] of Object.entries(POLICY_DECLARATIONS)) {
    const value = content[field as keyof typeof POLICY_DECLARATIONS]
    if (value === undefined) continue
    if (value) unsupported(field, value)
    calls.push(policyDeclaration(ids, id, type, { '1': question, '9': { '1': false } }))
  }

  for (const [field, { id, type, question, none }] of Object.entries(NONE_OF_THESE)) {
    const value = content[field as keyof typeof NONE_OF_THESE]
    if (value === undefined) continue
    if (value) unsupported(field, value)
    calls.push(policyDeclaration(ids, id, type, { '1': question, '6': { '1': [none] } }))
  }

  if (content.targetAges) {
    const bands = content.targetAges.map((age) => TARGET_AGE_BANDS[age] ?? unsupported('targetAges', age))
    calls.push({
      name: 'target audience',
      path: `${app}/targetAudienceContent`,
      method: 'PATCH',
      mask: [
        'age_screen_present',
        'certified_ad_network',
        'children_laws_compliance',
        'family_category',
        'family_opt_in',
        'supported_audience',
        'target_age_bands',
      ],
      body: { '1': bands, '11': true, '12': 0 },
    })
  }

  return calls
}

type IarcSubmission = {
  questionnaireId: string
  version: string
  email: string
  answers: Record<string, number>
}

export function iarcQuestionnaireBody(ids: AppIds, submission: IarcSubmission) {
  return {
    '1': { ...appRef(ids), '3': { '1': submission.questionnaireId } },
    '2': submission.version,
    '3': submission.email,
    '4': {
      '1': Object.entries(submission.answers).map(([question, answer]) => ({
        '1': Number(question),
        '2': [answer],
      })),
    },
    '5': IARC_QUESTIONNAIRE_TYPE,
    '7': 'en-US',
  }
}

export function findQuestionnaireId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined
  const node = response as Record<string, unknown>
  const ref = node['3'] as Record<string, unknown> | undefined
  if (node['1'] && ref && typeof ref['1'] === 'string') return ref['1']

  for (const child of Object.values(node)) {
    const found = findQuestionnaireId(child)
    if (found) return found
  }
  return undefined
}
