import { useEffect, useMemo, useState } from 'react'
import { Bell, Check, ChevronRight, CircleUserRound, Clock3, History, Home, RotateCcw, Settings, ShieldCheck, Sparkles, WashingMachine, X } from 'lucide-react'
import { completeCycle, estimatedWaitMinutes, expireClaim, expireRemoval, initialState, joinCombined, joinQueue, leaveQueue, outstandingLoads, removeClothes, requestAnotherLoad, RESIDENTS, sendClaimReminder, startCycle, tick, verifyPin } from './engine'
import type { AppState, Machine, MachineId, MachineStatus } from './types'

const STORAGE_KEY = 'wash-plus-state-v1'
type Tab = 'home' | 'activity' | 'settings'

const stateLabels: Record<MachineStatus, string> = {
  AVAILABLE: 'Available', RESERVED: 'Reserved', CLAIM_WINDOW: 'Ready to claim', RUNNING: 'In use',
  REMOVAL_GRACE: 'Cycle complete', REMOVAL_OVERDUE: 'Removal overdue',
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    const saved = JSON.parse(raw) as AppState
    saved.combinedReservations ??= {}
    return tick(saved)
  } catch { return initialState() }
}

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function StatusPill({ status }: { status: MachineStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}><i />{stateLabels[status]}</span>
}

interface CardProps {
  machine: Machine; state: AppState; userId: string; now: number
  update: (next: AppState) => void; onClaim: (id: MachineId) => void
}

function MachineCard({ machine: m, state, userId, now, update, onClaim }: CardProps) {
  const active = RESIDENTS.find(r => r.id === m.activeUserId)
  const pos = m.queue.findIndex(q => q.userId === userId)
  const myQueuedLoads = m.queue.filter(q => q.userId === userId).length
  const myOutstandingLoads = outstandingLoads(m, userId)
  const isMyTurn = m.status === 'CLAIM_WINDOW' && m.activeUserId === userId
  const isMyCycle = m.activeUserId === userId && ['RUNNING', 'REMOVAL_GRACE', 'REMOVAL_OVERDUE'].includes(m.status)
  const remaining = m.deadline ? m.deadline - now : 0
  const queueNames = m.queue.map(q => RESIDENTS.find(r => r.id === q.userId)?.name.split(' ')[0])
  const canJoin = myOutstandingLoads < 2

  return <article className={`machine-card ${isMyTurn ? 'your-turn' : ''}`}>
    <div className="machine-head">
      <div className="machine-icon"><WashingMachine size={23} /></div>
      <div><h2>{m.name}</h2><p>{m.cycleMinutes} min cycle</p></div>
      <StatusPill status={m.status} />
    </div>

    {m.status === 'AVAILABLE' && <div className="state-message available"><strong>Ready for a load</strong><span>No one is waiting right now.</span></div>}

    {m.status === 'RESERVED' && <div className="state-message reserved"><strong>Reserved for {active?.name}</strong><span>Wash + Dry transfer is pending</span></div>}

    {m.status === 'CLAIM_WINDOW' && <div className="state-message claim">
      <div><strong>{isMyTurn ? 'It’s your turn!' : `${active?.name} is up next`}</strong><span>{m.claimCallSent ? 'AI called · final grace period' : 'Claim window closes in'}</span></div>
      <div className="timer">{formatTime(remaining)}</div>
    </div>}

    {m.status === 'RUNNING' && <div className="state-message running">
      <div><strong>{isMyCycle ? 'Your load is running' : `${active?.name}’s load`}</strong><span>Estimated time remaining</span></div>
      <div className="timer">{formatTime(remaining)}</div>
    </div>}

    {m.status === 'REMOVAL_GRACE' && <div className="state-message removal">
      <div><strong>{isMyCycle ? 'Your cycle is done' : `Waiting for ${active?.name}`}</strong><span>Please remove clothes</span></div>
      <div className="timer">{formatTime(remaining)}</div>
    </div>}

    {m.status === 'REMOVAL_OVERDUE' && <div className="state-message overdue"><strong>Clothes moved aside</strong><span>The next resident may proceed.</span></div>}

    {pos >= 0 && !isMyTurn && <div className="queue-position">
      <span className="position-number">#{pos + 1}</span>
      <div><strong>{myQueuedLoads > 1 ? `${myQueuedLoads} loads reserved` : 'You’re in line'}</strong><span>First load · about {estimatedWaitMinutes(m, userId, now)} min wait</span></div>
      <button className="text-button" onClick={() => update(leaveQueue(state, m.id, userId))}>Leave</button>
    </div>}

    {m.status === 'CLAIM_WINDOW' && <button className={isMyTurn ? 'primary pulse' : 'secondary'} onClick={() => onClaim(m.id)}>{isMyTurn ? `Claim ${m.name}` : 'Check reservation'}<ChevronRight size={19} /></button>}
    {isMyCycle && m.status === 'REMOVAL_GRACE' && <button className="primary" onClick={() => update(removeClothes(state, m.id, userId))}><Check size={19} />I’ve removed my clothes</button>}
    {canJoin && m.status !== 'AVAILABLE' && <button className="secondary" onClick={() => update(requestAnotherLoad(state, m.id, userId))}>{myOutstandingLoads > 0 ? 'Reserve another load' : `Join ${m.name} queue`}</button>}
    {canJoin && m.status === 'AVAILABLE' && <button className="primary" onClick={() => update(requestAnotherLoad(state, m.id, userId))}>Use {m.name} now<ChevronRight size={19} /></button>}

    <div className="queue-row">
      <span>{m.queue.length} {m.queue.length === 1 ? 'load' : 'loads'} queued</span>
      {queueNames.length > 0 && <span className="avatars" aria-label={`Queue: ${queueNames.join(', ')}`}>{queueNames.slice(0, 3).map((n, i) => <i key={`${n}-${i}`}>{n?.[0]}</i>)}</span>}
    </div>
    {m.lastUserId === userId && m.consecutiveLoads > 0 && <p className="fair-note">Fair-use count: {m.consecutiveLoads} consecutive load{m.consecutiveLoads === 1 ? '' : 's'}</p>}
    {myOutstandingLoads >= 2 && <p className="fair-note">Two loads reserved · start or finish one before adding another.</p>}
  </article>
}

function PinModal({ machine, userId, state, onClose, update }: { machine: Machine; userId: string; state: AppState; onClose: () => void; update: (s: AppState) => void }) {
  const [pin, setPin] = useState(''), [error, setError] = useState(''), [verified, setVerified] = useState(false)
  const [verifiedState, setVerifiedState] = useState<AppState | null>(null)
  const reservedFor = RESIDENTS.find(r => r.id === machine.activeUserId)!
  function check() {
    const result = verifyPin(state, machine.id, userId, pin)
    update(result.state); setError(result.error || ''); setVerified(result.ok); setVerifiedState(result.ok ? result.state : null)
  }
  function start() { if (verifiedState) update(startCycle(verifiedState, machine.id, userId)); onClose() }
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="pin-title">
      <button className="close" aria-label="Close" onClick={onClose}><X /></button>
      <div className="modal-icon"><ShieldCheck /></div>
      <h2 id="pin-title">Confirm it’s you</h2>
      <p>{machine.name} is reserved for <strong>{reservedFor.name}</strong>, Unit {reservedFor.unit}.</p>
      {!verified ? <>
        <label htmlFor="pin">Enter your 4-digit app PIN</label>
        <input id="pin" className={error ? 'error-input' : ''} inputMode="numeric" autoFocus maxLength={4} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError('') }} onKeyDown={e => e.key === 'Enter' && pin.length === 4 && check()} placeholder="••••" />
        {error && <div className="error-message">{error}</div>}
        <button className="primary" disabled={pin.length !== 4} onClick={check}>Verify identity</button>
      </> : <>
        <div className="verified"><Check />Identity verified</div>
        <button className="primary pay" onClick={start}><Sparkles size={18} />Simulated Pay &amp; Start</button>
        <small>SIMULATED PAYMENT · No charge will be made</small>
      </>}
    </section>
  </div>
}

function App() {
  const [state, setState] = useState<AppState>(loadState)
  const [userId, setUserId] = useState('maya')
  const [tab, setTab] = useState<Tab>('home')
  const [now, setNow] = useState(Date.now())
  const [claiming, setClaiming] = useState<MachineId | null>(null)
  const [notifsOpen, setNotifsOpen] = useState(false)
  const [loadType, setLoadType] = useState<'both' | 'wash' | 'dry'>('both')
  const user = RESIDENTS.find(r => r.id === userId)!

  const update = (next: AppState) => setState(next)
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }, [state])
  useEffect(() => {
    const timer = setInterval(() => { const n = Date.now(); setNow(n); setState(s => tick(s, n)) }, 500)
    return () => clearInterval(timer)
  }, [])
  const notifications = useMemo(() => state.events.filter(e => e.kind !== 'activity' && (!e.userId || e.userId === userId)), [state.events, userId])

  function reset() { localStorage.removeItem(STORAGE_KEY); setState(initialState()); setClaiming(null) }
  function joinSelected() {
    if (loadType === 'both') setState(joinCombined(state, userId))
    else setState(requestAnotherLoad(state, loadType === 'dry' ? 'dryer' : 'washer', userId))
  }
  function loadScenario(kind: 'busy' | 'handoff' | 'linked' | 'security' | 'reminder' | 'removal' | 'fairness') {
    let s = initialState(); s.demoMode = state.demoMode
    let selectedUser = 'maya'

    if (kind === 'busy') {
      s = joinQueue(s, 'washer', 'jordan'); s = startCycle(s, 'washer', 'jordan')
      s = joinQueue(s, 'washer', 'maya'); s = joinQueue(s, 'washer', 'priya')
      s = joinQueue(s, 'dryer', 'alex'); s = startCycle(s, 'dryer', 'alex')
    } else if (kind === 'handoff') {
      s = joinQueue(s, 'washer', 'jordan'); s = joinQueue(s, 'washer', 'maya')
      selectedUser = 'jordan'
    } else if (kind === 'linked') {
      s = joinCombined(s, 'maya'); s = startCycle(s, 'washer', 'maya')
    } else if (kind === 'security') {
      s = joinQueue(s, 'washer', 'jordan'); s = joinQueue(s, 'washer', 'maya')
      selectedUser = 'maya'
    } else if (kind === 'reminder') {
      s = joinQueue(s, 'washer', 'maya'); s = joinQueue(s, 'washer', 'jordan')
      s = sendClaimReminder(s, 'washer')
    } else if (kind === 'removal') {
      s = joinQueue(s, 'washer', 'jordan'); s = startCycle(s, 'washer', 'jordan'); s = completeCycle(s, 'washer')
      s = joinQueue(s, 'washer', 'maya')
      selectedUser = 'jordan'
    } else {
      s = joinQueue(s, 'washer', 'alex'); s = startCycle(s, 'washer', 'alex')
      s.machines.washer.lastUserId = 'alex'; s.machines.washer.consecutiveLoads = 2
      s = joinQueue(s, 'washer', 'maya'); s = joinQueue(s, 'washer', 'jordan')
      selectedUser = 'alex'
    }

    setState(s); setUserId(selectedUser); setTab('home'); setNotifsOpen(false)
  }

  return <div className="app-shell">
    <header>
      <div className="brand"><div><b>WASH<span>+</span></b><small>Hawthorne House</small></div></div>
      <button className="bell" aria-label="Notifications" onClick={() => setNotifsOpen(v => !v)}><Bell />{notifications.length > 0 && <i>{Math.min(9, notifications.length)}</i>}</button>
    </header>

    {notifsOpen && <aside className="notification-panel">
      <div className="panel-title"><h2>Notifications</h2><button className="close" onClick={() => setNotifsOpen(false)}><X /></button></div>
      {notifications.length === 0 ? <p className="empty">You’re all caught up.</p> : notifications.slice(0, 8).map(n => <div className={`notification ${n.kind}`} key={n.id}><Bell size={16}/><div><p>{n.message}</p><time>{new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · SIMULATED</time></div></div>)}
    </aside>}

    <main>
      {tab === 'home' && <>
        <section className="hello"><div><p>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'},</p><h1>{user.name.split(' ')[0]} <span>👋</span></h1></div><div className="demo-badge"><i />Demo mode</div></section>
        <section className="switcher"><label htmlFor="resident"><CircleUserRound size={17}/> Demo user</label><select id="resident" value={userId} onChange={e => setUserId(e.target.value)}>{RESIDENTS.map(r => <option key={r.id} value={r.id}>{r.name} · Unit {r.unit}</option>)}</select></section>
        <section className="load-planner">
          <div><h2>What do you need?</h2><span>Wash + Dry reserves both machines for 95 minutes.</span></div>
          <div className="segments" role="group" aria-label="Load type">
            <button className={loadType === 'both' ? 'active' : ''} onClick={() => setLoadType('both')}>Wash + Dry</button>
            <button className={loadType === 'wash' ? 'active' : ''} onClick={() => setLoadType('wash')}>Wash Only</button>
            <button className={loadType === 'dry' ? 'active' : ''} onClick={() => setLoadType('dry')}>Dry Only</button>
          </div>
          <button className="planner-action" onClick={joinSelected}>{loadType === 'both' ? 'Reserve both machines · 95 min' : `Join ${loadType === 'dry' ? 'dryer' : 'washer'} queue`} <ChevronRight size={16}/></button>
        </section>
        <div className="section-heading"><div><h2>Laundry room</h2><p>Live status · Ground floor</p></div><span><i /> Updated now</span></div>
        <div className="machine-list">{(['washer', 'dryer'] as MachineId[]).map(id => <MachineCard key={id} machine={state.machines[id]} state={state} userId={userId} now={now} update={update} onClaim={setClaiming} />)}</div>
        <div className="tip"><Clock3/><p><strong>Wash + Dry stays connected.</strong><br/>Both queue positions are reserved together. After washing, your dryer claim opens automatically.</p></div>
      </>}

      {tab === 'activity' && <section className="page"><p className="eyebrow">DEMONSTRATION AUDIT TRAIL</p><h1>Activity log</h1><p className="page-intro">Every queue action, check, notification, and simulated event appears here.</p><div className="event-list">{state.events.length === 0 ? <div className="empty-card">No activity yet. Join a machine queue to begin.</div> : state.events.map(e => <div className="event" key={e.id}><span className={`event-dot ${e.kind}`} /> <div><p>{e.message}</p><time>{new Date(e.at).toLocaleString()} · {e.kind === 'call' ? 'SIMULATED CALL' : e.kind.toUpperCase()}</time></div></div>)}</div></section>}

      {tab === 'settings' && <section className="page"><p className="eyebrow">PROTOTYPE CONTROLS</p><h1>Demo &amp; settings</h1><div className="setting-card"><div><h2>Presentation demo mode</h2><p>Claim window: 25 sec · AI-call grace: 15 sec · removal grace: 15 sec · cycles: 50–65 sec. Fast-forward controls remain available below.</p></div><label className="toggle"><input type="checkbox" checked={state.demoMode} onChange={e => setState(s => ({ ...s, demoMode: e.target.checked }))}/><span /></label></div>
        <div className="control-card"><h2>Machine signals</h2>{(['washer','dryer'] as MachineId[]).map(id => { const m = state.machines[id]; const label = m.status === 'RUNNING' ? 'Simulate cycle complete' : m.status === 'CLAIM_WINDOW' ? (m.claimCallSent ? 'Expire final grace' : 'Trigger AI reminder call') : m.status === 'REMOVAL_GRACE' ? 'Fast-forward removal timer' : 'No active timer'; return <div className="control-row" key={id}><div><strong>{m.name}</strong><span>{stateLabels[m.status]}</span></div><button disabled={!['RUNNING','CLAIM_WINDOW','REMOVAL_GRACE'].includes(m.status)} onClick={() => m.status === 'RUNNING' ? update(completeCycle(state, id)) : m.status === 'CLAIM_WINDOW' ? update(m.claimCallSent ? expireClaim(state, id) : sendClaimReminder(state, id)) : update(expireRemoval(state, id))}>{label}</button></div>})}<small>SIMULATED MACHINE SIGNALS &amp; AI CALLS</small></div>
        <div className="scenario-section">
          <h2>Presentation scenarios</h2>
          <p>Each preset resets the demo and opens Home at the exact state you need.</p>
          <div className="scenario-grid">
            <button onClick={() => loadScenario('busy')}><span>01</span><div><strong>Busy queue</strong><small>Position + estimated wait</small></div></button>
            <button onClick={() => loadScenario('handoff')}><span>02</span><div><strong>Normal handoff</strong><small>Jordan ready to claim</small></div></button>
            <button onClick={() => loadScenario('linked')}><span>03</span><div><strong>Linked Wash + Dry</strong><small>Washer running, dryer reserved</small></div></button>
            <button onClick={() => loadScenario('security')}><span>04</span><div><strong>Wrong user + PIN</strong><small>Start as Maya; turn belongs to Jordan</small></div></button>
            <button onClick={() => loadScenario('reminder')}><span>05</span><div><strong>AI reminder</strong><small>Final claim grace is active</small></div></button>
            <button onClick={() => loadScenario('removal')}><span>06</span><div><strong>Removal grace</strong><small>Cycle done; clothes await removal</small></div></button>
            <button onClick={() => loadScenario('fairness')}><span>07</span><div><strong>Two-load fairness</strong><small>As Alex, tap Reserve another load</small></div></button>
          </div>
        </div>
        <button className="reset-button" onClick={reset}><RotateCcw/>Reset app and local data</button>
        <p className="disclaimer">This prototype uses fictional residents and in-browser data only. It does not connect to payment, calling, notification, authentication, or commercial laundry services.</p>
      </section>}
    </main>

    <nav aria-label="Main navigation">
      <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><Home/>Home</button>
      <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}><History/>Activity</button>
      <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings/>Demo</button>
    </nav>
    {claiming && <PinModal machine={state.machines[claiming]} userId={userId} state={state} update={update} onClose={() => setClaiming(null)} />}
  </div>
}

export default App
