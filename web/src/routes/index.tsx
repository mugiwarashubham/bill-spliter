import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useState } from 'react'

export const Route = createFileRoute('/')({ component: Home })

type Share = {
  id: string
  memberId: string
  memberName: string
  amountCents: number
  paidAt: string | null
}
type Bill = { id: string; title: string; totalCents: number; shares: Share[] }
type ApiError = { error?: string }

function Home() {
  const [homeId, setHomeId] = useState(() => localStorage.getItem('bill-splitter-home') ?? '')
  const [homeName, setHomeName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [billTitle, setBillTitle] = useState('')
  const [totalCents, setTotalCents] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadBills = useCallback(
    async (id = homeId) => {
      if (!id) {
        setBills([])
        return
      }
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/homes/${encodeURIComponent(id)}/bills`)
        const data = (await response.json()) as { bills?: Bill[] } & ApiError
        if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
        setBills(data.bills ?? [])
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load bills. Check your connection and try again.',
        )
      } finally {
        setLoading(false)
      }
    },
    [homeId],
  )

  useEffect(() => {
    void loadBills()
  }, [loadBills])

  async function submit(
    path: string,
    body: unknown,
    success: (data: Record<string, unknown>) => void,
  ) {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as Record<string, unknown> & ApiError
      if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
      success(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The request failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function createHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit('/api/homes', { name: homeName }, (data) => {
      const id = String(data.id)
      setHomeId(id)
      localStorage.setItem('bill-splitter-home', id)
      setHomeName('')
      void loadBills(id)
    })
  }

  function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit(`/api/homes/${encodeURIComponent(homeId)}/members`, { name: memberName }, () =>
      setMemberName(''),
    )
  }

  function createBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit(
      `/api/homes/${encodeURIComponent(homeId)}/bills`,
      { title: billTitle, totalCents: Number(totalCents) },
      () => {
        setBillTitle('')
        setTotalCents('')
        void loadBills()
      },
    )
  }

  async function pay(share: Share) {
    setError('')
    const keyName = `bill-splitter-payment-${share.id}`
    const key = sessionStorage.getItem(keyName) ?? crypto.randomUUID()
    sessionStorage.setItem(keyName, key)
    setBusy(true)
    try {
      const response = await fetch(
        `/api/bills/${encodeURIComponent(bills.find((bill) => bill.shares.some((item) => item.id === share.id))?.id ?? '')}/shares/${encodeURIComponent(share.id)}/pay`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': key },
        },
      )
      const data = (await response.json()) as ApiError
      if (!response.ok) throw new Error(data.error ?? `Payment failed (${response.status})`)
      await loadBills()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Payment failed. Your share is still unpaid; retry safely.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          split<span>wise</span>
        </a>
        <span className="top-note">Shared home expenses</span>
      </header>
      <section className="hero">
        <div className="eyebrow">HOUSEHOLD FINANCES, MADE SIMPLE</div>
        <h1>
          Keep the math
          <br />
          <em>out of the group chat.</em>
        </h1>
        <p>One place for shared bills, clear shares, and easy payments.</p>
      </section>
      {!homeId ? (
        <section className="setup panel">
          <div className="section-kicker">GET STARTED</div>
          <h2>Create your home</h2>
          <p className="muted">
            Start a shared space, then invite household members by adding them below.
          </p>
          <form onSubmit={createHome} className="inline-form">
            <input
              required
              value={homeName}
              onChange={(e) => setHomeName(e.target.value)}
              placeholder="Home name, e.g. Flat 4B"
              aria-label="Home name"
            />
            <button type="submit" disabled={busy}>
              Create home <span>→</span>
            </button>
          </form>
        </section>
      ) : (
        <>
          <div className="home-strip">
            <div>
              <div className="section-kicker">YOUR HOME</div>
              <strong>{homeId}</strong>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                localStorage.removeItem('bill-splitter-home')
                setHomeId('')
                setBills([])
              }}
            >
              Switch home
            </button>
          </div>
          <div className="forms-grid">
            <section className="panel form-panel">
              <div className="section-kicker">01 / HOUSEHOLD</div>
              <h2>Add a member</h2>
              <form onSubmit={addMember}>
                <input
                  required
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Member name"
                  aria-label="Member name"
                />
                <button type="submit" disabled={busy}>
                  Add member <span>＋</span>
                </button>
              </form>
            </section>
            <section className="panel form-panel">
              <div className="section-kicker">02 / NEW EXPENSE</div>
              <h2>Log a bill</h2>
              <form onSubmit={createBill}>
                <input
                  required
                  value={billTitle}
                  onChange={(e) => setBillTitle(e.target.value)}
                  placeholder="What was it for?"
                  aria-label="Bill title"
                />
                <div className="money-input">
                  <span>¢</span>
                  <input
                    required
                    inputMode="numeric"
                    type="number"
                    min="1"
                    step="1"
                    value={totalCents}
                    onChange={(e) => setTotalCents(e.target.value)}
                    placeholder="Total in cents"
                    aria-label="Total in cents"
                  />
                </div>
                <button type="submit" disabled={busy}>
                  Split this bill <span>→</span>
                </button>
              </form>
            </section>
          </div>
          <section className="bills-section">
            <div className="bills-heading">
              <div>
                <div className="section-kicker">THE LEDGER</div>
                <h2>Recent bills</h2>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => void loadBills()}
                disabled={loading}
              >
                {loading ? 'Refreshing…' : '↻ Refresh'}
              </button>
            </div>
            {loading && bills.length === 0 ? (
              <div className="state panel">Loading your bills…</div>
            ) : bills.length === 0 ? (
              <div className="empty panel">
                <div className="empty-icon">＋</div>
                <h3>Your ledger is clear</h3>
                <p>Add a household member and log your first shared bill.</p>
              </div>
            ) : (
              <div className="bill-list">
                {bills.map((bill, index) => (
                  <article className="bill-card panel" key={bill.id}>
                    <div className="bill-head">
                      <div className="bill-title">
                        <span className="bill-index">{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <h3>{bill.title}</h3>
                          <p>
                            {bill.shares.length} {bill.shares.length === 1 ? 'share' : 'shares'}
                          </p>
                        </div>
                      </div>
                      <div className="bill-total">${(bill.totalCents / 100).toFixed(2)}</div>
                    </div>
                    <div className="share-list">
                      {bill.shares.map((share) => (
                        <div className="share-row" key={share.id}>
                          <div className="avatar">{share.memberName.slice(0, 1).toUpperCase()}</div>
                          <span className="share-name">{share.memberName}</span>
                          <span className="share-amount">
                            ${(share.amountCents / 100).toFixed(2)}
                          </span>
                          {share.paidAt ? (
                            <span className="paid-badge">✓ Paid</span>
                          ) : (
                            <button
                              type="button"
                              className="pay-button"
                              disabled={busy}
                              onClick={() => void pay(share)}
                            >
                              Pay share <span>→</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>!</span>
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      <footer>MADE FOR THE PEOPLE YOU LIVE WITH · EVERY CENT, ACCOUNTED FOR</footer>
    </main>
  )
}
