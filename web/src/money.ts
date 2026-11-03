export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100)
  const rest = String(cents % 100).padStart(2, '0')
  return `${dollars}.${rest}`
}

export function toCents(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const dollars = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  return dollars * 100 + cents
}
