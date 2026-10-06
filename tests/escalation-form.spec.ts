import { describe, expect, it } from 'vitest'
import { IDS, handleFakeApiRequest as call } from '~/utils/clientFakeApi'
import type { EscalationPolicy } from '~/utils/clientFakeApi'
import {
  TRIGGER_LABELS,
  emptyPolicyForm,
  emptyStepForm,
  formProblem,
  formToWrite,
  parseReassign,
  policyToForm,
  reassignValueOf,
  stepProblem,
  stepToWrite,
  triggerMin,
  triggerUnit,
} from '~/utils/escalation-form'

// The escalation editor's form model ↔ wire mapping, pinned against the
// mock's REAL seeded policies and the mock's own POST — so "keep the step ids
// when editing" and "a step left out is deleted" are proven on the contract,
// not assumed. Same session helpers as tests/admin-config.spec.ts.

interface Session { cookie: string, csrf: string }

function login(email: string, password: string): Session {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  const data = res.body!.data as { csrfToken: string, _sessionCookie: string }
  return { cookie: `st_session=${data._sessionCookie}`, csrf: data.csrfToken }
}

const H = IDS.hotel.simatupang
const h = (s: Session) => ({ 'cookie': s.cookie, 'x-csrf-token': s.csrf, 'x-hotel-id': H })
const admin = () => login('admin@aston.example', 'admin123')
const getPolicy = (s: Session, id: string) => call(`/v1/escalation-policies/${id}`, { headers: h(s) }).body!.data as EscalationPolicy
const postPolicy = (s: Session, body: unknown) => call('/v1/escalation-policies', { method: 'POST', headers: h(s), body: body as Record<string, unknown> }).body!.data as EscalationPolicy

describe('policyToForm', () => {
  it('reads the seeded Urgent policy into the editor shape, ids kept and steps by sort', () => {
    const form = policyToForm(getPolicy(admin(), IDS.policy.smtpUrgent))
    expect(form.id).toBe(IDS.policy.smtpUrgent)
    expect(form.name).toBe('Urgent escalation')
    expect(form.isDefault).toBe(false)
    expect(form.isActive).toBe(true)
    expect(form.steps.map(s => s.id)).toEqual([IDS.step.urgUnassigned, IDS.step.urgOverdue])
    // Step 0: unclaimed 10 min → reassign to the Engineering team, tell the team.
    expect(form.steps[0]).toMatchObject({
      triggerKind: 'UNASSIGNED_FOR',
      triggerValue: 10,
      bumpPriority: false,
      reassign: `team:${IDS.team.engineering}`,
      routeToDepartmentId: '',
      notifyDepartmentLeaders: false,
      notifyAdmins: false,
      notifyAssignee: false,
      notifyTeamIds: [IDS.team.engineering],
      notifyStaffIds: [],
    })
    // Step 1: 15 min past resolution → bump, tell admins and the assignee.
    expect(form.steps[1]).toMatchObject({ triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 15, bumpPriority: true, reassign: '', notifyAdmins: true, notifyAssignee: true })
  })

  it('orders steps by sort even when the payload does not', () => {
    const policy = getPolicy(admin(), IDS.policy.smtpStandard)
    const shuffled = { ...policy, steps: [...policy.steps].reverse() }
    expect(policyToForm(shuffled).steps.map(s => s.id)).toEqual([IDS.step.stdResponse, IDS.step.stdHalfway, IDS.step.stdOverdue])
  })
})

describe('formToWrite', () => {
  it('sends isActive and isDefault explicitly, sort = position, and no id key for a new policy or step', () => {
    const form = emptyPolicyForm()
    form.name = '  Night audit  '
    form.steps = [emptyStepForm(), { ...emptyStepForm(), triggerKind: 'UNASSIGNED_FOR', triggerValue: 30 }]
    const write = formToWrite(form)
    expect('id' in write).toBe(false)
    expect(write).toMatchObject({ name: 'Night audit', isDefault: false, isActive: true })
    expect(write.steps!.map(s => s.sort)).toEqual([0, 1])
    expect(write.steps!.every(s => !('id' in s))).toBe(true)
  })

  it('maps actions and recipients to the API vocabulary, one action per type, duplicates folded', () => {
    const write = stepToWrite({
      ...emptyStepForm(),
      triggerKind: 'PERCENT_OF_RESOLUTION',
      triggerValue: 50,
      bumpPriority: true,
      reassign: `staff:${IDS.staff.budi}`,
      routeToDepartmentId: IDS.dept.smtpMaintenance,
      notifyDepartmentLeaders: true,
      notifyAdmins: true,
      notifyAssignee: true,
      notifyTeamIds: [IDS.team.engineering, IDS.team.engineering],
      notifyStaffIds: [IDS.staff.budi, IDS.staff.made],
    }, 3)
    expect(write.sort).toBe(3)
    expect(write.actions).toEqual([
      { type: 'bumpPriority' },
      { type: 'reassign', staffId: IDS.staff.budi },
      { type: 'routeToDepartment', hotelDepartmentId: IDS.dept.smtpMaintenance },
    ])
    expect(write.recipients).toEqual([
      { kind: 'departmentLeaders' },
      { kind: 'admins' },
      { kind: 'assignee' },
      { kind: 'team', teamId: IDS.team.engineering },
      { kind: 'staff', staffId: IDS.staff.budi },
      { kind: 'staff', staffId: IDS.staff.made },
    ])
  })

  it('round-trips the seeded Standard policy through the mock: same step ids, same content', () => {
    const a = admin()
    const before = getPolicy(a, IDS.policy.smtpStandard)
    const after = postPolicy(a, formToWrite(policyToForm(before)))
    expect(after.steps.map(s => s.id)).toEqual(before.steps.map(s => s.id))
    for (const [i, step] of after.steps.entries()) {
      const was = before.steps[i]!
      expect(step).toMatchObject({ sort: was.sort, triggerKind: was.triggerKind, triggerValue: was.triggerValue })
      expect(step.actions).toEqual(expect.arrayContaining(was.actions))
      expect(step.actions).toHaveLength(was.actions.length)
      expect(step.recipients).toEqual(expect.arrayContaining(was.recipients))
      expect(step.recipients).toHaveLength(was.recipients.length)
    }
    expect(after.isDefault).toBe(true)
    expect(after.isActive).toBe(true)
  })

  it('keeps edited steps by id and deletes a step the editor dropped — the API applies the omission', () => {
    // Leaves behind: an inactive "Form round trip" policy at Simatupang.
    const a = admin()
    const form = emptyPolicyForm()
    form.name = 'Form round trip'
    form.steps = [
      { ...emptyStepForm(), triggerKind: 'RESPONSE_OVERDUE', triggerValue: 5 },
      { ...emptyStepForm(), triggerKind: 'RESOLUTION_OVERDUE', triggerValue: 10, bumpPriority: true },
      { ...emptyStepForm(), triggerKind: 'UNASSIGNED_FOR', triggerValue: 20, reassign: `team:${IDS.team.engineering}` },
    ]
    const created = postPolicy(a, formToWrite(form))
    expect(created.steps).toHaveLength(3)
    const [first, second, third] = created.steps.map(s => s.id)

    // Edit: drop the middle step, move the last one up, change its value, add a new one at the end.
    const edit = policyToForm(created)
    edit.steps.splice(1, 1)
    edit.steps[1]!.triggerValue = 25
    edit.steps.push({ ...emptyStepForm(), triggerKind: 'PERCENT_OF_RESOLUTION', triggerValue: 80, notifyAdmins: true })
    edit.isActive = false
    const write = formToWrite(edit)
    expect(write.id).toBe(created.id)
    expect(write.steps!.map(s => s.id ?? null)).toEqual([first, third, null])
    expect(write.steps!.map(s => s.sort)).toEqual([0, 1, 2])

    const updated = postPolicy(a, write)
    expect(updated.isActive).toBe(false)
    expect(updated.steps.map(s => s.id).slice(0, 2)).toEqual([first, third])
    expect(updated.steps.map(s => s.id)).not.toContain(second)
    expect(updated.steps.map(s => [s.sort, s.triggerKind, s.triggerValue])).toEqual([
      [0, 'RESPONSE_OVERDUE', 5],
      [1, 'UNASSIGNED_FOR', 25],
      [2, 'PERCENT_OF_RESOLUTION', 80],
    ])
    // The same form sent again is a no-op on ids: nothing is recreated.
    const again = postPolicy(a, formToWrite(policyToForm(updated)))
    expect(again.steps.map(s => s.id)).toEqual(updated.steps.map(s => s.id))
  })
})

describe('reassign picker value', () => {
  it('encodes exactly one target and decodes it back', () => {
    expect(reassignValueOf(undefined)).toBe('')
    expect(reassignValueOf({ type: 'reassign', staffId: 'a' })).toBe('staff:a')
    expect(reassignValueOf({ type: 'reassign', teamId: 'b' })).toBe('team:b')
    expect(parseReassign('')).toBeNull()
    expect(parseReassign('staff:a')).toEqual({ staffId: 'a' })
    expect(parseReassign('team:b')).toEqual({ teamId: 'b' })
  })
})

describe('local checks', () => {
  it('labels and units every trigger kind the API knows', () => {
    expect(Object.keys(TRIGGER_LABELS).sort()).toEqual(['PERCENT_OF_RESOLUTION', 'RESOLUTION_OVERDUE', 'RESPONSE_OVERDUE', 'UNASSIGNED_FOR'])
    expect(triggerUnit('PERCENT_OF_RESOLUTION')).toBe('%')
    expect(triggerUnit('UNASSIGNED_FOR')).toBe('min')
    expect(triggerMin('RESPONSE_OVERDUE')).toBe(0)
    expect(triggerMin('UNASSIGNED_FOR')).toBe(1)
    expect(triggerMin('PERCENT_OF_RESOLUTION')).toBe(1)
  })

  it('mirrors the API\'s value ranges per trigger kind', () => {
    expect(stepProblem({ ...emptyStepForm(), triggerKind: 'RESPONSE_OVERDUE', triggerValue: 0 })).toBeNull()
    expect(stepProblem({ ...emptyStepForm(), triggerKind: 'RESPONSE_OVERDUE', triggerValue: -1 })).toBe('Minutes cannot be negative.')
    expect(stepProblem({ ...emptyStepForm(), triggerKind: 'UNASSIGNED_FOR', triggerValue: 0 })).toBe('Unassigned-for needs at least 1 minute.')
    expect(stepProblem({ ...emptyStepForm(), triggerKind: 'PERCENT_OF_RESOLUTION', triggerValue: 0 })).toBe('Percent must be 1-100.')
    expect(stepProblem({ ...emptyStepForm(), triggerKind: 'PERCENT_OF_RESOLUTION', triggerValue: 101 })).toBe('Percent must be 1-100.')
    expect(stepProblem({ ...emptyStepForm(), triggerValue: 1.5 })).toBe('Value must be a whole number.')
  })

  it('names the first problem with the form, or none', () => {
    const form = emptyPolicyForm()
    expect(formProblem(form)).toBe('Name is required.')
    form.name = 'X'
    expect(formProblem(form)).toBeNull()
    form.steps = [emptyStepForm(), { ...emptyStepForm(), triggerKind: 'UNASSIGNED_FOR', triggerValue: 0 }]
    expect(formProblem(form)).toBe('Step 2: Unassigned-for needs at least 1 minute.')
    form.steps = Array.from({ length: 11 }, () => emptyStepForm())
    expect(formProblem(form)).toBe('A policy has at most 10 steps.')
  })
})
