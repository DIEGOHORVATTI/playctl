import { createInterface } from 'node:readline/promises'

export type Choice<T> = { label: string; value: T; hint?: string }

const KEYS = { up: '\u001b[A', down: '\u001b[B', enter: '\r', ctrlC: '\u0003' }
const DIM = (text: string) => `\u001b[2m${text}\u001b[22m`
const CYAN = (text: string) => `\u001b[36m${text}\u001b[39m`

export function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

export async function ask(question: string, initial = '') {
  const reader = createInterface({ input: process.stdin, output: process.stdout })
  const suffix = initial ? DIM(` (${initial})`) : ''
  const answer = (await reader.question(`${CYAN('?')} ${question}${suffix} `)).trim()
  reader.close()

  return answer || initial
}

export function select<T>(question: string, choices: Choice<T>[], initialIndex = 0, note?: string) {
  let index = Math.max(0, Math.min(initialIndex, choices.length - 1))
  const lines = () => choices.length + (note ? 2 : 1)

  const render = (first: boolean) => {
    if (!first) process.stdout.write(`\u001b[${lines()}A\u001b[J`)
    process.stdout.write(`${CYAN('?')} ${question}\n`)
    if (note) process.stdout.write(`  ${DIM(note)}\n`)
    choices.forEach((choice, position) => {
      const marker = position === index ? CYAN('❯') : ' '
      const hint = choice.hint ? DIM(`  ${choice.hint}`) : ''
      process.stdout.write(`${marker} ${choice.label}${hint}\n`)
    })
  }

  return new Promise<T>((resolve) => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    render(true)

    const onKey = (data: Buffer) => {
      const key = data.toString()
      if (key === KEYS.ctrlC) process.exit(130)
      if (key === KEYS.up) index = (index - 1 + choices.length) % choices.length
      if (key === KEYS.down) index = (index + 1) % choices.length
      if (key !== KEYS.enter) return render(false)

      process.stdin.off('data', onKey)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve(choices[index]!.value)
    }
    process.stdin.on('data', onKey)
  })
}
