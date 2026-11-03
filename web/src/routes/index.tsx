import { createFileRoute } from '@tanstack/react-router'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  addMember,
  type Bill,
  createBill,
  createHome,
  listBills,
  messageOf,
  payShare,
  type Share,
} from '../api'
import { formatCents, toCents } from '../money'

export const Route = createFileRoute('/')({
  component: Home,
})

const STORAGE_KEY = 'bill-splitter-home'

function readSavedHome(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function saveHome(homeId: string | null) {
  try {
    if (homeId === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, homeId)
  } catch {
    // Storage can be blocked. The page still works without it.
  }
}

function Home() {
  const [homeId, setHomeId] = useState<string | null>(readSavedHome)

  function open(id: string | null) {
    saveHome(id)
    setHomeId(id)
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <h1>Bill Splitter</h1>
      {homeId === null ? (
        <StartScreen onOpen={open} />
      ) : (
        <BillsView homeId={homeId} onLeave={() => open(null)} />
      )}
    </main>
  )
}

function StartScreen({ onOpen }: { onOpen: (id: string) => void }) {
  const [existing, setExisting] = useState('')
  const existingId = useId()

  return (
    <section>
      <h2>Create a home</h2>
      <NameForm
        label="Home name"
        buttonLabel="Create home"
        onSubmit={async (name) => {
          const home = await createHome(name)
          onOpen(home.id)
        }}
      />
      <h2>Or open an existing home</h2>
      <label htmlFor={existingId}>Home id </label>
      <input
        id={existingId}
        value={existing}
        onChange={(event) => setExisting(event.target.value)}
      />{' '}
      <button
        type="button"
        disabled={existing.trim().length === 0}
        onClick={() => onOpen(existing.trim())}
      >
        Open
      </button>
    </section>
  )
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; bills: Bill[] }

function BillsView({ homeId, onLeave }: { homeId: string; onLeave: () => void }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const latest = useRef(0)

  const load = useCallback(async () => {
    const id = ++latest.current
    setState({ status: 'loading' })
    try {
      const bills = await listBills(homeId)
      if (id === latest.current) setState({ status: 'ready', bills })
    } catch (error) {
      if (id === latest.current) {
        setState({ status: 'error', message: messageOf(error) })
      }
    }
  }, [homeId])

  useEffect(() => {
    void load()
  }, [load])

  function markPaid(billId: string, shareId: string, paidAt: string) {
    setState((current) => {
      if (current.status !== 'ready') return current
      return {
        status: 'ready',
        bills: current.bills.map((bill) =>
          bill.id !== billId
            ? bill
            : {
                ...bill,
                shares: bill.shares.map((share) =>
                  share.id === shareId ? { ...share, paidAt } : share,
                ),
              },
        ),
      }
    })
  }

  return (
    <section>
      <p>
        Home id: <code>{homeId}</code>{' '}
        <button type="button" onClick={onLeave}>
          Switch home
        </button>
      </p>

      <h2>Add a member</h2>
      <NameForm
        label="Member name"
        buttonLabel="Add member"
        onSubmit={async (name) => {
          await addMember(homeId, name)
        }}
      />

      <h2>Add a bill</h2>
      <BillForm
        onSubmit={async (title, cents) => {
          await createBill(homeId, title, cents)
          await load()
        }}
      />

      <h2>Bills</h2>
      {state.status === 'loading' && <p>Loading bills…</p>}
      {state.status === 'error' && (
        <div role="alert">
          <p>Could not load bills: {state.message}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {state.status === 'ready' && state.bills.length === 0 && (
        <p>No bills yet. Add a member first, then add a bill.</p>
      )}
      {state.status === 'ready' &&
        state.bills.map((bill) => (
          <article key={bill.id} style={{ borderTop: '1px solid #ccc', paddingTop: 8 }}>
            <h3>
              {bill.title} - {formatCents(bill.totalCents)}
            </h3>
            <ul>
              {bill.shares.map((share) => (
                <ShareRow key={share.id} billId={bill.id} share={share} onPaid={markPaid} />
              ))}
            </ul>
          </article>
        ))}
    </section>
  )
}

function ShareRow({
  billId,
  share,
  onPaid,
}: {
  billId: string
  share: Share
  onPaid: (billId: string, shareId: string, paidAt: string) => void
}) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const keyRef = useRef<string | null>(null)
  const inFlight = useRef(false)

  async function pay() {
    if (inFlight.current) return
    inFlight.current = true
    // Reuse the same key when retrying, so a retry can never pay twice.
    const key = keyRef.current ?? crypto.randomUUID()
    keyRef.current = key
    setPaying(true)
    setError('')
    try {
      const result = await payShare(billId, share.id, key)
      keyRef.current = null
      onPaid(billId, share.id, result.paidAt)
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      inFlight.current = false
      setPaying(false)
    }
  }

  return (
    <li>
      {share.memberName}: {formatCents(share.amountCents)}{' '}
      {share.paidAt !== null ? (
        <strong>Paid</strong>
      ) : (
        <button type="button" disabled={paying} onClick={() => void pay()}>
          {paying ? 'Paying…' : error ? 'Retry payment' : 'Pay'}
        </button>
      )}
      {error !== '' && <span role="alert"> Payment failed: {error}</span>}
    </li>
  )
}

function NameForm({
  label,
  buttonLabel,
  onSubmit,
}: {
  label: string
  buttonLabel: string
  onSubmit: (value: string) => Promise<void>
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(value)
      setValue('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor={id}>{label} </label>
      <input id={id} value={value} onChange={(event) => setValue(event.target.value)} />{' '}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : buttonLabel}
      </button>
      {error !== '' && <p role="alert">{error}</p>}
    </form>
  )
}

function BillForm({ onSubmit }: { onSubmit: (title: string, cents: number) => Promise<void> }) {
  const titleId = useId()
  const amountId = useId()
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const cents = toCents(amount)
    if (cents === null) {
      setError('Enter an amount like 12.50')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSubmit(title, cents)
      setTitle('')
      setAmount('')
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor={titleId}>Title </label>
      <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} />{' '}
      <label htmlFor={amountId}>Amount </label>
      <input id={amountId} value={amount} onChange={(event) => setAmount(event.target.value)} />{' '}
      <button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Add bill'}
      </button>
      {error !== '' && <p role="alert">{error}</p>}
    </form>
  )
}
