import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'

export const USAGE = [
  'playctl: Google Play Console from the terminal',
  '',
  'Usage:',
  '  playctl status',
  '  playctl promote <versionCode> [--from alpha] [--to production]',
  '  playctl images <listing.json>   replace store images of each language',
  '  playctl stats [installs|store_performance] [--bucket gs://pubsite_prod_...]',
  '',
  'Options:',
  '  --package <name>   application id (or PLAY_PACKAGE_NAME, or .playctl.json)',
  '  --key <file>       service account JSON (or PLAY_KEY_FILE, or .playctl.json)',
  '',
  `Default key: ${join('~', '.config', 'playctl', 'key.json')}`,
].join('\n')

type ProjectConfig = {
  reportsBucket?: string
  packageName?: string
  keyFile?: string
}

export type Invocation = {
  command: string | undefined
  positional: string[]
  packageName: string
  keyFile: string
  from: string
  to: string
  bucket: string
}

type Environment = {
  cwd: string
  env: Record<string, string | undefined>
  home: string
}

const expandHome = (path: string, home: string) => path.replace(/^~(?=$|\/)/, home)

function readProjectConfig(cwd: string): ProjectConfig {
  const file = join(cwd, '.playctl.json')

  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProjectConfig) : {}
}

export function parseInvocation(
  argv: string[],
  { cwd, env, home }: Environment = { cwd: process.cwd(), env: process.env, home: homedir() },
): Invocation {
  const flags = new Map<string, string>()
  const positional: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg.startsWith('--') && argv[index + 1]) flags.set(arg.slice(2), argv[++index]!)
    else positional.push(arg)
  }

  const config = readProjectConfig(cwd)
  const [command, ...rest] = positional
  const packageName = flags.get('package') ?? env.PLAY_PACKAGE_NAME ?? config.packageName
  if (command && !packageName) throw new Error(`Missing --package.\n\n${USAGE}`)

  const keyFile =
    flags.get('key') ??
    env.PLAY_KEY_FILE ??
    config.keyFile ??
    join(home, '.config', 'playctl', 'key.json')

  return {
    command,
    positional: rest,
    packageName: packageName ?? '',
    keyFile: expandHome(keyFile, home),
    from: flags.get('from') ?? 'alpha',
    to: flags.get('to') ?? 'production',
    bucket: (flags.get('bucket') ?? env.PLAY_REPORTS_BUCKET ?? config.reportsBucket ?? '').replace(
      /^gs:\/\/|\/.*$/g,
      '',
    ),
  }
}
