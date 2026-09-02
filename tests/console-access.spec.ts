import { describe, expect, it } from 'vitest'
import { demoLogins, handleFakeApiRequest as call } from '~/utils/clientFakeApi'
import type { Staff } from '~/utils/clientFakeApi'
import { CONSOLE_DENIED_MESSAGE, adminReach, admitsRole, admitsToConsole } from '~/composables/useConsoleAccess'

// The console's own admission rule, asserted against the mock's REAL demo
// accounts rather than a hardcoded list — a seed that makes the login screen
// and the gate disagree fails here, not in front of a user.

function loginStaff(email: string, password: string): Staff {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  return (res.body!.data as { staff: Staff }).staff
}

describe('console admission', () => {
  it('admits every demo account the sign-in screen offers, and only those', () => {
    for (const demo of demoLogins()) {
      const staff = loginStaff(demo.email, demo.password)
      const admitted = admitsToConsole(staff)
      const offered = admitsRole(demo.role, demo.isOperator)
      // The one-value proxy the login screen filters by must agree with the
      // real admission rule for every seeded account.
      expect(offered, `${demo.email}: offered=${offered} admitted=${admitted}`).toBe(admitted)
    }
  })

  it('turns plain staff and leaders away', () => {
    const budi = loginStaff('staff@aston.example', 'staff123')
    expect(admitsToConsole(budi)).toBe(false)
    const sari = loginStaff('leader@aston.example', 'leader123')
    expect(admitsToConsole(sari)).toBe(false)
  })

  it('admits a property admin with their hotel reach', () => {
    const agus = loginStaff('admin@aston.example', 'admin123')
    expect(admitsToConsole(agus)).toBe(true)
    expect(adminReach(agus)).toEqual(agus.hotels)
    expect(agus.hotels.length).toBeGreaterThan(0)
  })

  it('admits an operator with ZERO property reach — platform screens only', () => {
    const operator = loginStaff('operator@sentineltech.example', 'operator123')
    expect(operator.isOperator).toBe(true)
    expect(admitsToConsole(operator)).toBe(true)
    expect(adminReach(operator)).toEqual([])
  })

  it('gives a regional admin reach over every granted hotel', () => {
    const rina = loginStaff('regional@aston.example', 'regional123')
    expect(admitsToConsole(rina)).toBe(true)
    // Direct at Kuningan plus the Aston group grant: two hotels.
    expect(adminReach(rina).length).toBe(2)
  })

  it('has a doorstep message that names both admitted roles', () => {
    expect(CONSOLE_DENIED_MESSAGE).toContain('property admins')
    expect(CONSOLE_DENIED_MESSAGE).toContain('operators')
  })
})
