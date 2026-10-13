export type MachineId = 'washer' | 'dryer'
export type MachineStatus = 'AVAILABLE' | 'RESERVED' | 'CLAIM_WINDOW' | 'RUNNING' | 'REMOVAL_GRACE' | 'REMOVAL_OVERDUE'

export interface Resident { id: string; name: string; unit: string; pin: string }
export interface QueueEntry { userId: string; joinedAt: number; combinedId?: string }
export interface CombinedReservation { id: string; userId: string; phase: 'washer' | 'dryer'; createdAt: number }
export interface Machine {
  id: MachineId
  name: string
  cycleMinutes: number
  status: MachineStatus
  queue: QueueEntry[]
  activeUserId?: string
  activeCombinedId?: string
  deadline?: number
  claimCallSent?: boolean
  lastUserId?: string
  consecutiveLoads: number
}
export interface AppEvent { id: string; at: number; kind: 'notification' | 'activity' | 'call'; message: string; userId?: string }
export interface AppState { machines: Record<MachineId, Machine>; events: AppEvent[]; demoMode: boolean; combinedReservations: Record<string, CombinedReservation> }
