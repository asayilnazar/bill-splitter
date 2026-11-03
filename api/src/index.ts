import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

app.notFound((c) => c.json({ error: 'not found' }, 404))

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function readName(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const name = (body as Record<string, unknown>).name
  if (typeof name !== 'string' || name.trim().length === 0) return null
  return name.trim()
}

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const name = readName(await readJson(c.req.raw))
  if (name === null) return c.json({ error: 'name is required' }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()
  return c.json({ id, name }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  const home = await c.env.DB.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const name = readName(await readJson(c.req.raw))
  if (name === null) return c.json({ error: 'name is required' }, 422)

  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()
  return c.json({ id, homeId, name }, 201)
})
type BillRow = { id: string; title: string; total_cents: number }

app.get('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const db = c.env.DB

  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results: bills } = await db
    .prepare('SELECT id, title, total_cents FROM bills WHERE home_id = ? ORDER BY rowid')
    .bind(homeId)
    .all<BillRow>()

  const { results: shares } = await db
    .prepare(
      `SELECT s.id, s.bill_id, s.member_id, s.amount_cents, s.paid_at, m.name
       FROM shares s
       JOIN bills b ON b.id = s.bill_id
       JOIN members m ON m.id = s.member_id
       WHERE b.home_id = ?
       ORDER BY s.rowid`,
    )
    .bind(homeId)
    .all<{
      id: string
      bill_id: string
      member_id: string
      amount_cents: number
      paid_at: string | null
      name: string
    }>()

  return c.json({
    bills: bills.map((bill) => ({
      id: bill.id,
      homeId,
      title: bill.title,
      totalCents: bill.total_cents,
      shares: shares
        .filter((share) => share.bill_id === bill.id)
        .map((share) => ({
          id: share.id,
          memberId: share.member_id,
          memberName: share.name,
          amountCents: share.amount_cents,
          paidAt: share.paid_at,
        })),
    })),
  })
})

type ShareRow = {
  id: string
  member_id: string
  amount_cents: number
  paid_at: string | null
  payment_key: string | null
}

function splitCents(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const extra = total % count
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0))
}

function readBill(body: unknown): { title: string; totalCents: number } | null {
  if (typeof body !== 'object' || body === null) return null
  const { title, totalCents } = body as Record<string, unknown>
  if (typeof title !== 'string' || title.trim().length === 0) return null
  if (typeof totalCents !== 'number' || !Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return null
  }
  return { title: title.trim(), totalCents }
}

app.post('/api/homes/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  const db = c.env.DB

  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const input = readBill(await readJson(c.req.raw))
  if (input === null) {
    return c.json({ error: 'title and a positive whole totalCents are required' }, 422)
  }

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY rowid')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) {
    return c.json({ error: 'home has no members' }, 422)
  }

  const amounts = splitCents(input.totalCents, members.length)
  const billId = crypto.randomUUID()
  const shares = members.map((member, i) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[i] ?? 0,
    paidAt: null,
  }))

  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, input.title, input.totalCents),
    ...shares.map((share) =>
      db
        .prepare('INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)')
        .bind(share.id, billId, share.memberId, share.amountCents),
    ),
  ])

  return c.json(
    {
      id: billId,
      homeId,
      title: input.title,
      totalCents: input.totalCents,
      shares,
    },
    201,
  )
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return c.json({ error: 'Idempotency-Key header is required' }, 400)

  const billId = c.req.param('billId')
  const shareId = c.req.param('shareId')
  const db = c.env.DB

  const update = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, payment_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .run()

  const row = await db
    .prepare(
      `SELECT id, member_id, amount_cents, paid_at, payment_key
       FROM shares WHERE id = ? AND bill_id = ?`,
    )
    .bind(shareId, billId)
    .first<ShareRow>()
  if (!row) return c.json({ error: 'bill or share not found' }, 404)

  if (update.meta.changes === 0 && row.payment_key !== key) {
    return c.json({ error: 'share already paid with a different key' }, 409)
  }

  return c.json(
    {
      id: row.id,
      memberId: row.member_id,
      amountCents: row.amount_cents,
      paidAt: row.paid_at,
    },
    200,
  )
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  const db = c.env.DB

  const home = await db.prepare('SELECT id FROM homes WHERE id = ?').bind(homeId).first()
  if (!home) return c.json({ error: 'home not found' }, 404)

  const { results } = await db
    .prepare(
      `SELECT m.id AS memberId, m.name AS name,
              COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
       FROM members m
       LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
       WHERE m.home_id = ?
       GROUP BY m.id
       ORDER BY m.rowid`,
    )
    .bind(homeId)
    .all<{ memberId: string; name: string; outstandingCents: number }>()

  return c.json({ balances: results })
})
export default app
