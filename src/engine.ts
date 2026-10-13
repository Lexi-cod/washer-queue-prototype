import type { AppEvent, AppState, Machine, MachineId, Resident } from './types'

export const RESIDENTS: Resident[] = [
  { id: 'maya', name: 'Maya Chen', unit: '08', pin: '2468' },
  { id: 'jordan', name: 'Jordan Lee', unit: '14', pin: '1357' },
  { id: 'alex', name: 'Alex Rivera', unit: '21', pin: '4826' },
  { id: 'priya', name: 'Priya Shah', unit: '05', pin: '9071' },
]

export const durations = (demo: boolean) => ({ claim: demo ? 25_000 : 10 * 60_000, callGrace: demo ? 15_000 : 2 * 60_000, removal: demo ? 15_000 : 5 * 60_000 })
export const cycleDuration = (machine: Machine, demo: boolean) => demo ? (machine.id === 'washer' ? 50_000 : 65_000) : machine.cycleMinutes * 60_000

export function initialState(): AppState {
  const machine = (id: MachineId, name: string, cycleMinutes: number): Machine => ({ id, name, cycleMinutes, status: 'AVAILABLE', queue: [], consecutiveLoads: 0 })
  return { machines: { washer: machine('washer', 'Washer 1', 40), dryer: machine('dryer', 'Dryer 1', 55) }, events: [], demoMode: true, combinedReservations: {} }
}

const event = (message: string, kind: AppEvent['kind'] = 'activity', userId?: string, at = Date.now()): AppEvent =>
  ({ id: `${at}-${Math.random().toString(36).slice(2)}`, at, kind, message, userId })
const copy = (s: AppState): AppState => structuredClone(s)
const resident = (id?: string) => RESIDENTS.find(r => r.id === id)

export function outstandingLoads(machine: Machine, userId: string): number {
  const queued = machine.queue.filter(q => q.userId === userId).length
  const activeOutsideQueue = machine.activeUserId === userId && machine.status !== 'CLAIM_WINDOW' && machine.status !== 'RESERVED' ? 1 : 0
  return queued + activeOutsideQueue
}

export function activateNext(state: AppState, machineId: MachineId, now = Date.now()): AppState {
  const s = copy(state), m = s.machines[machineId]
  if (!m.queue.length) { m.status = 'AVAILABLE'; m.activeUserId = undefined; m.activeCombinedId = undefined; m.deadline = undefined; m.claimCallSent = false; return s }
  const entry = m.queue[0], next = entry.userId
  m.activeCombinedId = entry.combinedId
  const combined = entry.combinedId ? s.combinedReservations[entry.combinedId] : undefined
  if (machineId === 'dryer' && combined?.phase === 'washer') {
    m.status = 'RESERVED'; m.activeUserId = next; m.deadline = undefined; m.claimCallSent = false
    return s
  }
  m.status = 'CLAIM_WINDOW'; m.activeUserId = next; m.deadline = now + durations(s.demoMode).claim; m.claimCallSent = false
  s.events.unshift(event(`${m.name} is ready for ${resident(next)?.name}. Claim it now.`, 'notification', next, now))
  return s
}

export function joinCombined(state: AppState, userId: string, now = Date.now()): AppState {
  let s = copy(state)
  const washer = s.machines.washer, dryer = s.machines.dryer
  if (outstandingLoads(washer, userId) >= 2 || outstandingLoads(dryer, userId) >= 2) return s
  const combinedId = `combined-${userId}-${now}-${Math.random().toString(36).slice(2, 7)}`
  s.combinedReservations[combinedId] = { id: combinedId, userId, phase: 'washer', createdAt: now }
  washer.queue.push({ userId, joinedAt: now, combinedId })
  dryer.queue.push({ userId, joinedAt: now, combinedId })
  s.events.unshift(event(`${resident(userId)?.name} reserved Washer 1 + Dryer 1 for one combined 95-minute load.`, 'activity', userId, now))
  if (washer.status === 'AVAILABLE') s = activateNext(s, 'washer', now)
  if (s.machines.dryer.status === 'AVAILABLE') s = activateNext(s, 'dryer', now)
  return s
}

export function joinQueue(state: AppState, machineId: MachineId, userId: string, now = Date.now()): AppState {
  let s = copy(state); const m = s.machines[machineId]
  if (outstandingLoads(m, userId) >= 2) return s
  m.queue.push({ userId, joinedAt: now })
  s.events.unshift(event(`${resident(userId)?.name} joined the ${m.name} queue.`, 'activity', userId, now))
  if (m.status === 'AVAILABLE') s = activateNext(s, machineId, now)
  return s
}

export function leaveQueue(state: AppState, machineId: MachineId, userId: string, now = Date.now()): AppState {
  let s = copy(state); const m = s.machines[machineId]
  const combinedId = m.queue.find(q => q.userId === userId)?.combinedId
  if (combinedId) {
    ;(['washer', 'dryer'] as MachineId[]).forEach(id => {
      const linked = s.machines[id]
      linked.queue = linked.queue.filter(q => q.combinedId !== combinedId)
      if (linked.activeUserId === userId && ['CLAIM_WINDOW', 'RESERVED'].includes(linked.status)) {
        linked.status = 'AVAILABLE'; linked.activeUserId = undefined; linked.activeCombinedId = undefined; linked.deadline = undefined
      }
    })
    delete s.combinedReservations[combinedId]
    s.events.unshift(event(`${resident(userId)?.name} canceled the combined Washer 1 + Dryer 1 reservation.`, 'activity', userId, now))
    if (s.machines.washer.status === 'AVAILABLE') s = activateNext(s, 'washer', now)
    if (s.machines.dryer.status === 'AVAILABLE') s = activateNext(s, 'dryer', now)
    return s
  }
  const wasActive = m.status === 'CLAIM_WINDOW' && m.activeUserId === userId
  const leaveIndex = m.queue.findIndex(q => q.userId === userId)
  if (leaveIndex >= 0) m.queue.splice(leaveIndex, 1)
  s.events.unshift(event(`${resident(userId)?.name} left the ${m.name} queue.`, 'activity', userId, now))
  if (wasActive) s = activateNext(s, machineId, now)
  return s
}

export type PinResult = { state: AppState; ok: boolean; error?: string }
export function verifyPin(state: AppState, machineId: MachineId, currentUserId: string, pin: string, now = Date.now()): PinResult {
  const s = copy(state), m = s.machines[machineId]
  if (m.status !== 'CLAIM_WINDOW' || m.activeUserId !== currentUserId) {
    s.events.unshift(event(`Blocked claim attempt on ${m.name}: someone else's turn.`, 'activity', currentUserId, now))
    return { state: s, ok: false, error: "This is someone else’s turn." }
  }
  if (resident(currentUserId)?.pin !== pin) {
    s.events.unshift(event(`Incorrect PIN entered for ${m.name}.`, 'activity', currentUserId, now))
    return { state: s, ok: false, error: 'Incorrect PIN' }
  }
  s.events.unshift(event(`Identity verified for ${resident(currentUserId)?.name} on ${m.name}.`, 'activity', currentUserId, now))
  return { state: s, ok: true }
}

export function startCycle(state: AppState, machineId: MachineId, userId: string, now = Date.now()): AppState {
  const s = copy(state), m = s.machines[machineId]
  if (m.status !== 'CLAIM_WINDOW' || m.activeUserId !== userId) return s
  const activeIndex = m.queue.findIndex(q => q.userId === userId && q.combinedId === m.activeCombinedId)
  if (activeIndex >= 0) m.queue.splice(activeIndex, 1)
  m.consecutiveLoads = m.lastUserId === userId ? m.consecutiveLoads + 1 : 1
  m.lastUserId = userId; m.status = 'RUNNING'; m.deadline = now + cycleDuration(m, s.demoMode); m.claimCallSent = false
  s.events.unshift(event(`${resident(userId)?.name} started ${m.name} — simulated payment approved.`, 'activity', userId, now))
  return s
}

export function completeCycle(state: AppState, machineId: MachineId, now = Date.now()): AppState {
  const s = copy(state), m = s.machines[machineId]
  if (m.status !== 'RUNNING') return s
  m.status = 'REMOVAL_GRACE'; m.deadline = now + durations(s.demoMode).removal
  s.events.unshift(event(`Your ${m.name} cycle is complete. Please remove your clothes.`, 'notification', m.activeUserId, now))
  return s
}

export function removeClothes(state: AppState, machineId: MachineId, userId: string, now = Date.now()): AppState {
  let s = copy(state); const m = s.machines[machineId]
  if (!['REMOVAL_GRACE', 'REMOVAL_OVERDUE'].includes(m.status) || m.activeUserId !== userId) return s
  const combinedId = m.activeCombinedId
  s.events.unshift(event(`${resident(userId)?.name} removed clothes from ${m.name}.`, 'activity', userId, now))
  m.activeUserId = undefined; m.activeCombinedId = undefined; m.deadline = undefined
  s = activateNext(s, machineId, now)
  if (machineId === 'washer' && combinedId && s.combinedReservations[combinedId]) {
    s.combinedReservations[combinedId].phase = 'dryer'
    const dryer = s.machines.dryer
    if (dryer.status === 'RESERVED' && dryer.activeUserId === userId) s = activateNext(s, 'dryer', now)
    s.events.unshift(event(`Dryer 1 is now ready for ${resident(userId)?.name}'s reserved transfer.`, 'notification', userId, now))
  } else if (machineId === 'dryer' && combinedId) {
    delete s.combinedReservations[combinedId]
  }
  return s
}

export function expireClaim(state: AppState, machineId: MachineId, now = Date.now()): AppState {
  let s = copy(state); const m = s.machines[machineId]
  if (m.status !== 'CLAIM_WINDOW' || !m.activeUserId) return s
  const missed = m.activeUserId
  const missedIndex = m.queue.findIndex(q => q.userId === missed && q.combinedId === m.activeCombinedId)
  const [missedEntry] = missedIndex >= 0 ? m.queue.splice(missedIndex, 1) : []
  m.queue.push({ userId: missed, joinedAt: now, combinedId: missedEntry?.combinedId })
  s.events.unshift(event(`You missed your turn for ${m.name} and were moved to the end of the queue.`, 'notification', missed, now))
  s = activateNext(s, machineId, now)
  if (machineId === 'washer' && missedEntry?.combinedId) {
    const dryer = s.machines.dryer
    const linked = dryer.queue.find(q => q.combinedId === missedEntry.combinedId)
    if (linked) dryer.queue = [...dryer.queue.filter(q => q.combinedId !== missedEntry.combinedId), { ...linked, joinedAt: now }]
    if (dryer.status === 'RESERVED' && dryer.activeUserId === missed) s = activateNext({ ...s, machines: { ...s.machines, dryer: { ...dryer, status: 'AVAILABLE', activeUserId: undefined } } }, 'dryer', now)
  }
  return s
}

export function sendClaimReminder(state: AppState, machineId: MachineId, now = Date.now()): AppState {
  const s = copy(state), m = s.machines[machineId]
  if (m.status !== 'CLAIM_WINDOW' || !m.activeUserId || m.claimCallSent) return s
  const name = resident(m.activeUserId)?.name
  m.claimCallSent = true
  m.deadline = now + durations(s.demoMode).callGrace
  s.events.unshift(event(`SIMULATED AI CALL: “Hi ${name}, it’s your turn for ${m.name}. Please claim it now.”`, 'call', m.activeUserId, now))
  s.events.unshift(event(`AI reminder sent. Final claim grace period started for ${m.name}.`, 'notification', m.activeUserId, now))
  return s
}

export function expireRemoval(state: AppState, machineId: MachineId, now = Date.now()): AppState {
  let s = copy(state); const m = s.machines[machineId]
  if (m.status !== 'REMOVAL_GRACE' || !m.activeUserId) return s
  const late = m.activeUserId, name = resident(late)?.name
  const combinedId = m.activeCombinedId
  m.status = 'REMOVAL_OVERDUE'; m.deadline = undefined
  s.events.unshift(event(`SIMULATED AI CALL: “Hi ${name}, your laundry finished 5 minutes ago. Please collect it.”`, 'call', late, now))
  // Assume clothes are moved aside: immediately offer the machine to the next resident.
  m.activeUserId = undefined; m.activeCombinedId = undefined
  s = activateNext(s, machineId, now)
  if (machineId === 'washer' && combinedId && s.combinedReservations[combinedId]) {
    s.combinedReservations[combinedId].phase = 'dryer'
    const dryer = s.machines.dryer
    if (dryer.status === 'RESERVED' && dryer.activeUserId === late) s = activateNext(s, 'dryer', now)
  } else if (machineId === 'dryer' && combinedId) {
    delete s.combinedReservations[combinedId]
  }
  return s
}

export function requestAnotherLoad(state: AppState, machineId: MachineId, userId: string, now = Date.now()): AppState {
  const s = copy(state), m = s.machines[machineId]
  if (outstandingLoads(m, userId) >= 2) return s
  const othersWaiting = m.queue.some(q => q.userId !== userId)
  if (m.lastUserId === userId && m.consecutiveLoads >= 2 && othersWaiting) {
    m.queue.push({ userId, joinedAt: now })
    s.events.unshift(event(`Fair-use rule: ${resident(userId)?.name} moved to the end after two consecutive loads.`, 'notification', userId, now))
    return s
  }
  return joinQueue(s, machineId, userId, now)
}

export function tick(state: AppState, now = Date.now()): AppState {
  let s = state
  ;(['washer', 'dryer'] as MachineId[]).forEach(id => {
    const m = s.machines[id]
    if (!m.deadline || now < m.deadline) return
    if (m.status === 'CLAIM_WINDOW') s = m.claimCallSent ? expireClaim(s, id, now) : sendClaimReminder(s, id, now)
    else if (m.status === 'RUNNING') s = completeCycle(s, id, now)
    else if (m.status === 'REMOVAL_GRACE') s = expireRemoval(s, id, now)
  })
  return s
}

export function estimatedWaitMinutes(machine: Machine, userId: string, now = Date.now()): number {
  const index = machine.queue.findIndex(q => q.userId === userId)
  if (index < 0) return 0
  let remaining = 0
  if (machine.deadline && machine.status !== 'CLAIM_WINDOW') remaining = Math.max(0, machine.deadline - now) / 60_000
  return Math.ceil(remaining + index * machine.cycleMinutes)
}
