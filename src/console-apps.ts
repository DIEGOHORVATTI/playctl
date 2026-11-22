import { appRef } from './console-forms'

const APP_TYPE_APP = 1
const PACKAGE_AVAILABLE = 1

export const APP_CATEGORIES: Record<string, number> = {
  'books-and-reference': 30,
}

export type NewApp = {
  developerId: string
  name: string
  language: string
  packageName: string
}

export function createAppBody({ developerId, name, language, packageName }: NewApp) {
  if (!name || name.length > 30) throw new Error('--name is required and must have at most 30 characters')
  return {
    '1': { '1': developerId },
    '2': name,
    '3': language,
    '4': APP_TYPE_APP,
    '5': false,
    '6': true,
    '7': true,
    '9': { '1': true },
    '11': packageName,
  }
}

export function isPackageAvailable(response: unknown) {
  return (response as { '1'?: number } | undefined)?.['1'] === PACKAGE_AVAILABLE
}

export function createdAppId(response: unknown) {
  const id = (response as { '1'?: { '2'?: { '1'?: string } } } | undefined)?.['1']?.['2']?.['1']
  if (!id) throw new Error(`Play Console did not return the new app id: ${JSON.stringify(response)}`)
  return id
}

export function resolveCategory(value: string) {
  const id = APP_CATEGORIES[value] ?? (/^\d+$/.test(value) ? Number(value) : undefined)
  if (id === undefined) {
    throw new Error(
      `Unknown category "${value}". Use a numeric id or one of: ${Object.keys(APP_CATEGORIES).join(', ')}`,
    )
  }
  return id
}

export function categoryBody(ids: { developerId: string; appId: string }, category: number) {
  return { '1': appRef(ids), '3': { '1': category } }
}
