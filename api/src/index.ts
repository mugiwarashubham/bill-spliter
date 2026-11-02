import { type Context, Hono } from 'hono'

type Bindings = { DB: D1Database }
type Row = Record<string, string | number | null>
type ShareRow = { id: string; member_id: string; amount_cents: number; paid_at: string | null }

const app = new Hono<{ Bindings: Bindings }>()

app.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400)
  return c.json({ error: 'Internal server error' }, 500)
})
app.notFound((c) => c.json({ error: 'Route not found' }, 404))

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.post('/api/homes', async (c) => {
  const body = await readObject(c)
  if (!body || !validName(body.name)) return c.json({ error: 'Name is required' }, 422)
  const id = crypto.randomUUID()
  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)')
    .bind(id, body.name.trim())
    .run()
  return c.json({ id, name: body.name.trim() }, 201)
})

app.post('/api/homes/:homeId/members', async (c) => {
  const { homeId } = c.req.param()
  const body = await readObject(c)
  if (!body || !validName(body.name)) return c.json({ error: 'Name is required' }, 422)
  if (!(await exists(c.env.DB, 'homes', homeId))) return c.json({ error: 'Home not found' }, 404)
  const id = crypto.randomUUID()
  const name = body.name.trim()
  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()
  return c.json({ id, homeId, name }, 201)
})

app.post('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  const body = await readObject(c)
  if (!(await exists(c.env.DB, 'homes', homeId))) return c.json({ error: 'Home not found' }, 404)
  if (
    !body ||
    !validName(body.title) ||
    !Number.isSafeInteger(body.totalCents) ||
    Number(body.totalCents) <= 0
  ) {
    return c.json({ error: 'Title and a positive whole number of cents are required' }, 422)
  }
  const members = await c.env.DB.prepare(
    'SELECT id FROM members WHERE home_id = ? ORDER BY created_at, rowid',
  )
    .bind(homeId)
    .all<{ id: string }>()
  if (members.results.length === 0)
    return c.json({ error: 'Add a member before creating a bill' }, 422)

  const id = crypto.randomUUID()
  const title = body.title.trim()
  const totalCents = Number(body.totalCents)
  const base = Math.floor(totalCents / members.results.length)
  const remainder = totalCents % members.results.length
  const statements = [
    c.env.DB.prepare(
      'INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)',
    ).bind(id, homeId, title, totalCents),
    ...members.results.map((member, index) =>
      c.env.DB.prepare(
        'INSERT INTO shares (id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), id, member.id, base + (index < remainder ? 1 : 0)),
    ),
  ]
  await c.env.DB.batch(statements)
  const shares = await c.env.DB.prepare(
    'SELECT id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt FROM shares WHERE bill_id = ? ORDER BY rowid',
  )
    .bind(id)
    .all()
  return c.json({ id, homeId, title, totalCents, shares: shares.results }, 201)
})

app.get('/api/homes/:homeId/bills', async (c) => {
  const { homeId } = c.req.param()
  if (!(await exists(c.env.DB, 'homes', homeId))) return c.json({ error: 'Home not found' }, 404)
  const bills = await c.env.DB.prepare(
    'SELECT id, home_id AS homeId, title, total_cents AS totalCents FROM bills WHERE home_id = ? ORDER BY created_at, rowid',
  )
    .bind(homeId)
    .all<{ id: string; homeId: string; title: string; totalCents: number }>()
  const result = await Promise.all(
    bills.results.map(async (bill) => {
      const shares = await c.env.DB.prepare(
        `SELECT s.id, s.member_id AS memberId, m.name AS memberName,
       s.amount_cents AS amountCents, s.paid_at AS paidAt
       FROM shares s JOIN members m ON m.id = s.member_id
       WHERE s.bill_id = ? ORDER BY m.created_at, m.rowid`,
      )
        .bind(bill.id)
        .all()
      return { ...bill, shares: shares.results }
    }),
  )
  return c.json({ bills: result })
})

app.post('/api/bills/:billId/shares/:shareId/pay', async (c) => {
  const { billId, shareId } = c.req.param()
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) return c.json({ error: 'Idempotency-Key header is required' }, 400)
  const share = await c.env.DB.prepare(
    'SELECT s.id, s.member_id, s.amount_cents, s.paid_at, s.idempotency_key FROM shares s JOIN bills b ON b.id = s.bill_id WHERE b.id = ? AND s.id = ?',
  )
    .bind(billId, shareId)
    .first<ShareRow & { idempotency_key: string | null }>()
  if (!share) return c.json({ error: 'Bill or share not found' }, 404)
  if (share.paid_at) {
    if (share.idempotency_key === key) return c.json(paymentResponse(share))
    return c.json({ error: 'Share has already been paid' }, 409)
  }
  const paidAt = new Date().toISOString()
  const updated = await c.env.DB.prepare(
    'UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND bill_id = ? AND paid_at IS NULL',
  )
    .bind(paidAt, key, shareId, billId)
    .run()
  if (updated.meta.changes === 0) {
    const current = await c.env.DB.prepare(
      'SELECT id, member_id, amount_cents, paid_at, idempotency_key FROM shares WHERE id = ?',
    )
      .bind(shareId)
      .first<ShareRow & { idempotency_key: string | null }>()
    if (current?.idempotency_key === key && current.paid_at) return c.json(paymentResponse(current))
    return c.json({ error: 'Share has already been paid' }, 409)
  }
  return c.json({
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt,
  })
})

app.get('/api/homes/:homeId/balances', async (c) => {
  const { homeId } = c.req.param()
  if (!(await exists(c.env.DB, 'homes', homeId))) return c.json({ error: 'Home not found' }, 404)
  const rows = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name,
     COALESCE(SUM(CASE WHEN s.paid_at IS NULL THEN s.amount_cents ELSE 0 END), 0) AS outstandingCents
     FROM members m LEFT JOIN shares s ON s.member_id = m.id
     LEFT JOIN bills b ON b.id = s.bill_id AND b.home_id = m.home_id
     WHERE m.home_id = ? GROUP BY m.id, m.name ORDER BY m.created_at, m.rowid`,
  )
    .bind(homeId)
    .all()
  return c.json({ balances: rows.results })
})

async function readObject(
  c: Context<{ Bindings: Bindings }>,
): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null)
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function exists(db: D1Database, table: 'homes', id: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first<Row>()
  return row !== null
}

function paymentResponse(share: ShareRow) {
  return {
    id: share.id,
    memberId: share.member_id,
    amountCents: share.amount_cents,
    paidAt: share.paid_at,
  }
}

export default app
