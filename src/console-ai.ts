import { spawn } from 'node:child_process'

import type { IarcCatalog } from './console-catalog'
import { DECLARATION_QUESTIONS, TARGET_AGE_OPTIONS, type AppContent } from './console-forms'
import { answerLabel } from './console-catalog'

export type AiSuggestion = {
  appContent: Partial<AppContent>
  iarc: Record<string, number>
  reasons: Record<string, string>
}

const COMMANDS: Record<string, string[]> = {
  claude: ['claude', '-p', '--allowedTools', 'Read', 'Grep', 'Glob'],
  codex: ['codex', 'exec', '--sandbox', 'read-only', '-'],
}

function compactCatalog(catalog: IarcCatalog) {
  const revealedBy = new Map<number, number[]>()
  for (const rule of catalog['3']) for (const id of rule['2']) revealedBy.set(id, rule['1'])

  return catalog['2'].map((question) => ({
    id: question['1'],
    text: (question['11'] ?? question['5']).replace(/\s+/g, ' ').slice(0, 320),
    answers: (question['9'] ?? []).map((answer) => ({ id: answer['1'], label: answerLabel(answer) })),
    shownWhenAnswerIs: revealedBy.get(question['1']),
  }))
}

export function buildPrompt(packageName: string, catalog: IarcCatalog) {
  return `You are helping fill the Google Play Console "App content" forms for the Android app ${packageName}.
The app source code is in the current directory. Read what you need (app.json / AndroidManifest.xml,
permissions, package.json dependencies, ads or analytics SDKs, login screens, network calls, privacy policy
files) and answer from evidence in the code. Do not modify any file.

Declarations (true/false): ${DECLARATION_QUESTIONS.map(({ key, text }) => `\n- ${key}: ${text}`).join('')}
- privacyPolicyUrl: the public URL of the privacy policy, if the repo has one.
- targetAges: array with any of ${JSON.stringify(TARGET_AGE_OPTIONS)}.

IARC content rating questionnaire. Answer EVERY question that ends up shown: start at the question with no
shownWhenAnswerIs, and a question is shown when one of its shownWhenAnswerIs answers was chosen. Missing
answers are an error, so include all of them:
${JSON.stringify(compactCatalog(catalog))}

Reply with ONLY this JSON, no prose:
{"appContent":{"privacyPolicyUrl":"...","containsAds":false,"loginRequired":false,"usesAdvertisingId":false,"governmentApp":false,"financialFeatures":false,"healthFeatures":false,"collectsData":false,"targetAges":["18+"]},
 "iarc":{"<questionId>":<answerId>},
 "reasons":{"<declaration key or questionId>":"one short sentence with the evidence"}}`
}

export function parseSuggestion(output: string): AiSuggestion {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output)?.[1]
  const raw = fenced ?? output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)
  const parsed = JSON.parse(raw) as Partial<AiSuggestion>

  return { appContent: parsed.appContent ?? {}, iarc: parsed.iarc ?? {}, reasons: parsed.reasons ?? {} }
}

export function askAi(tool: string, prompt: string, cwd: string) {
  const command = COMMANDS[tool]
  if (!command) throw new Error(`--ai must be one of: ${Object.keys(COMMANDS).join(', ')}`)

  return new Promise<AiSuggestion>((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${tool} exited with ${code}`))
      try {
        resolve(parseSuggestion(output))
      } catch {
        reject(new Error(`${tool} did not return the expected JSON:\n${output.slice(-1500)}`))
      }
    })
    child.stdin.end(prompt)
  })
}
