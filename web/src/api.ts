export type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}

export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const TIMEOUT_MS = 8000

function readError(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const message = (data as Record<string, unknown>).error
  return typeof message === 'string' ? message : null
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(path, { ...init, signal: controller.signal })
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      throw new ApiError(readError(data) ?? `Request failed (${response.status})`, response.status)
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The server took too long to answer. Try again.', 0)
    }
    throw new ApiError('Could not reach the server. Check your connection.', 0)
  } finally {
    clearTimeout(timer)
  }
}

function post<T>(path: string, body: unknown, headers?: HeadersInit): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

export function createHome(name: string) {
  return post<{ id: string; name: string }>('/api/homes', { name })
}

export function addMember(homeId: string, name: string) {
  return post<{ id: string }>(`/api/homes/${homeId}/members`, { name })
}

export async function listBills(homeId: string): Promise<Bill[]> {
  const data = await request<{ bills: Bill[] }>(`/api/homes/${homeId}/bills`)
  return data.bills
}

export function createBill(homeId: string, title: string, totalCents: number) {
  return post<Bill>(`/api/homes/${homeId}/bills`, { title, totalCents })
}

export function payShare(billId: string, shareId: string, key: string) {
  return post<{ id: string; paidAt: string }>(
    `/api/bills/${billId}/shares/${shareId}/pay`,
    {},
    { 'Idempotency-Key': key },
  )
}
