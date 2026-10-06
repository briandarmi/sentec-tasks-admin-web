import type {
  EscalationAction,
  EscalationPolicy,
  EscalationPolicyWrite,
  EscalationRecipient,
  EscalationStep,
  EscalationStepWrite,
  EscalationTriggerKind,
} from '~/utils/clientFakeApi'
import { ESCALATION_MAX_STEPS } from '~/utils/clientFakeApi'

/**
 * The escalation-policy editor's form model and its mapping to and from the
 * wire (`EscalationPolicyWrite` / `EscalationPolicy`). Pure functions, so the
 * rules the API enforces on a POST can be pinned in `tests/escalation-form.spec.ts`
 * without a Nuxt runtime.
 *
 * What the mapping has to get right, from the API's design:
 *  - ONE POST upserts the policy AND its steps: a step sent with its id is
 *    updated, one without is created, a live step LEFT OUT is deleted. So the
 *    form keeps every loaded step's id and `formToWrite` resends all of them.
 *  - `sort` is the step's position in the list (0-9, unique) — the editor
 *    reorders by moving entries, never by typing a number.
 *  - Actions: at most one of each type; `reassign` names exactly one of
 *    staffId/teamId; `routeToDepartment` names a hotelDepartmentId.
 *  - Recipients: departmentLeaders / admins / assignee at most once each;
 *    team(teamId) and staff(staffId) may repeat with different targets.
 *  - `isActive` omitted means true on create / unchanged on update, so the
 *    form always sends it explicitly: what the switch shows is what is saved.
 */

export const TRIGGER_LABELS: Record<EscalationTriggerKind, string> = {
  RESPONSE_OVERDUE: 'Response overdue by',
  PERCENT_OF_RESOLUTION: '% of resolution time',
  RESOLUTION_OVERDUE: 'Resolution overdue by',
  UNASSIGNED_FOR: 'Unassigned for',
}

/** The unit the value input shows next to the trigger. */
export function triggerUnit(kind: EscalationTriggerKind): 'min' | '%' {
  return kind === 'PERCENT_OF_RESOLUTION' ? '%' : 'min'
}

/** The lowest value the API accepts for the trigger kind. */
export function triggerMin(kind: EscalationTriggerKind): number {
  return kind === 'PERCENT_OF_RESOLUTION' || kind === 'UNASSIGNED_FOR' ? 1 : 0
}

/**
 * The reassign picker's single value: '' for none, else `staff:<id>` or
 * `team:<id>` — one Select, because the API takes exactly one target.
 */
export type ReassignValue = '' | `staff:${string}` | `team:${string}`

export interface EscalationStepForm {
  /** Kept from the loaded policy; null for a step added in this session. */
  id: string | null
  triggerKind: EscalationTriggerKind
  triggerValue: number
  bumpPriority: boolean
  reassign: ReassignValue
  /** '' = no routing action. */
  routeToDepartmentId: string
  notifyDepartmentLeaders: boolean
  notifyAdmins: boolean
  notifyAssignee: boolean
  notifyTeamIds: string[]
  notifyStaffIds: string[]
}

export interface EscalationPolicyForm {
  id: string | null
  name: string
  isDefault: boolean
  isActive: boolean
  steps: EscalationStepForm[]
}

export function emptyStepForm(): EscalationStepForm {
  return {
    id: null,
    triggerKind: 'RESPONSE_OVERDUE',
    triggerValue: 0,
    bumpPriority: false,
    reassign: '',
    routeToDepartmentId: '',
    notifyDepartmentLeaders: true,
    notifyAdmins: false,
    notifyAssignee: false,
    notifyTeamIds: [],
    notifyStaffIds: [],
  }
}

export function emptyPolicyForm(): EscalationPolicyForm {
  return { id: null, name: '', isDefault: false, isActive: true, steps: [] }
}

/** `reassign` action → picker value. */
export function reassignValueOf(action: EscalationAction | undefined): ReassignValue {
  if (!action) return ''
  if (action.staffId) return `staff:${action.staffId}`
  if (action.teamId) return `team:${action.teamId}`
  return ''
}

/** Picker value → the `reassign` action's target, or null for none. */
export function parseReassign(value: string): { staffId?: string, teamId?: string } | null {
  if (value.startsWith('staff:')) return { staffId: value.slice('staff:'.length) }
  if (value.startsWith('team:')) return { teamId: value.slice('team:'.length) }
  return null
}

export function stepToForm(step: EscalationStep): EscalationStepForm {
  const find = (type: EscalationAction['type']) => step.actions.find(a => a.type === type)
  const has = (kind: EscalationRecipient['kind']) => step.recipients.some(r => r.kind === kind)
  return {
    id: step.id,
    triggerKind: step.triggerKind,
    triggerValue: step.triggerValue,
    bumpPriority: Boolean(find('bumpPriority')),
    reassign: reassignValueOf(find('reassign')),
    routeToDepartmentId: find('routeToDepartment')?.hotelDepartmentId ?? '',
    notifyDepartmentLeaders: has('departmentLeaders'),
    notifyAdmins: has('admins'),
    notifyAssignee: has('assignee'),
    notifyTeamIds: step.recipients.filter(r => r.kind === 'team' && r.teamId).map(r => r.teamId!),
    notifyStaffIds: step.recipients.filter(r => r.kind === 'staff' && r.staffId).map(r => r.staffId!),
  }
}

/** The loaded policy as the editor holds it — steps in sort order, ids kept. */
export function policyToForm(policy: EscalationPolicy): EscalationPolicyForm {
  return {
    id: policy.id,
    name: policy.name,
    isDefault: policy.isDefault,
    isActive: policy.isActive,
    steps: [...policy.steps].sort((a, b) => a.sort - b.sort).map(stepToForm),
  }
}

/** One step as the API wants it; `sort` is its position in the list. */
export function stepToWrite(step: EscalationStepForm, sort: number): EscalationStepWrite {
  const actions: EscalationAction[] = []
  if (step.bumpPriority) actions.push({ type: 'bumpPriority' })
  const target = parseReassign(step.reassign)
  if (target) actions.push({ type: 'reassign', ...target })
  if (step.routeToDepartmentId) actions.push({ type: 'routeToDepartment', hotelDepartmentId: step.routeToDepartmentId })

  const recipients: EscalationRecipient[] = []
  if (step.notifyDepartmentLeaders) recipients.push({ kind: 'departmentLeaders' })
  if (step.notifyAdmins) recipients.push({ kind: 'admins' })
  if (step.notifyAssignee) recipients.push({ kind: 'assignee' })
  // De-duplicated here: the API refuses the same team or person twice.
  for (const teamId of new Set(step.notifyTeamIds)) recipients.push({ kind: 'team', teamId })
  for (const staffId of new Set(step.notifyStaffIds)) recipients.push({ kind: 'staff', staffId })

  return {
    // The id travels only when there is one; `id: null` on a new step is
    // accepted too, but omitting it keeps the create case unambiguous.
    ...(step.id ? { id: step.id } : {}),
    sort,
    triggerKind: step.triggerKind,
    triggerValue: Number(step.triggerValue),
    actions,
    recipients,
  }
}

/** The whole POST body. Every kept step is resent (with its id) — a step missing here is a step deleted. */
export function formToWrite(form: EscalationPolicyForm): EscalationPolicyWrite {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    isDefault: form.isDefault,
    isActive: form.isActive,
    steps: form.steps.map((step, index) => stepToWrite(step, index)),
  }
}

// ── Local checks ─────────────────────────────────────────────────────────────
// Mirrors of the API's rules that can be told before the request, so Save is
// disabled with a reason rather than refused after. The API's own message is
// still shown verbatim whenever it does refuse.

/** The first problem with a step, in the admin's words, or null. */
export function stepProblem(step: EscalationStepForm): string | null {
  const value = Number(step.triggerValue)
  if (!Number.isInteger(value)) return 'Value must be a whole number.'
  if (step.triggerKind === 'PERCENT_OF_RESOLUTION' && (value < 1 || value > 100)) return 'Percent must be 1-100.'
  if (step.triggerKind === 'UNASSIGNED_FOR' && value < 1) return 'Unassigned-for needs at least 1 minute.'
  if (value < 0) return 'Minutes cannot be negative.'
  return null
}

/** The first problem with the whole form, or null when it can be sent. */
export function formProblem(form: EscalationPolicyForm): string | null {
  if (!form.name.trim()) return 'Name is required.'
  if (form.steps.length > ESCALATION_MAX_STEPS) return `A policy has at most ${ESCALATION_MAX_STEPS} steps.`
  for (const [index, step] of form.steps.entries()) {
    const problem = stepProblem(step)
    if (problem) return `Step ${index + 1}: ${problem}`
  }
  return null
}
