import { describe, expect, it } from 'vitest'
import { IDS, demoLogins, handleFakeApiRequest as call } from '~/utils/clientFakeApi'
import type { Staff } from '~/utils/clientFakeApi'
import { CONSOLE_DENIED_MESSAGE, adminReach, admitsRole, admitsToConsole } from '~/composables/useConsoleAccess'

// The console's own admission rule, asserted against the mock's REAL demo
// accounts rather than a hardcoded list — a seed that makes the login screen
// and the gate disagree fails here, not in front of a user.
//
// Roles are PER PROPERTY (feat/projects): the Staff payload carries
// `properties` (the reach) and `memberships` (role per hotel). `adminReach`
// reads the memberships that carry role admin — never `properties`.

function loginStaff(email: string, password: string): Staff {
  const res = call('/v1/auth/staff/login', { method: 'POST', query: { delivery: 'cookie' }, body: { email, password } })
  return (res.body!.data as { staff: Staff }).staff
}

/** The rule `useSession().role` applies: the membership at the selected hotel, or plain staff. */
const roleAt = (staff: Staff, hotelRef: string) => staff.memberships.find(m => m.hotelRef === hotelRef)?.role ?? 'staff'

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

  it('admits a property admin with the hotels where their membership is admin', () => {
    const agus = loginStaff('admin@aston.example', 'admin123')
    expect(admitsToConsole(agus)).toBe(true)
    const adminHotels = agus.memberships.filter(m => m.role === 'admin').map(m => m.hotelRef)
    expect(adminReach(agus)).toEqual(adminHotels)
    expect(adminReach(agus)).toEqual([IDS.hotel.simatupang])
  })

  it('admits an operator with ZERO property reach — platform screens only', () => {
    const operator = loginStaff('operator@sentineltech.example', 'operator123')
    expect(operator.isOperator).toBe(true)
    expect(admitsToConsole(operator)).toBe(true)
    expect(adminReach(operator)).toEqual([])
  })

  it('gives a regional admin reach over the hotels they are admin AT, not every hotel they can see', () => {
    const rina = loginStaff('regional@aston.example', 'regional123')
    expect(admitsToConsole(rina)).toBe(true)
    // Rina is admin at Kuningan and reaches Simatupang through the Aston
    // group grant. The branch notes do not say what role a grant confers, so
    // the mock's documented assumption is that a grant-only hotel has NO
    // membership: she can see it, but she is not an admin there. One hotel
    // of reach, where the old account-wide model gave her two.
    expect(rina.properties.map(p => p.hotelRef)).toContain(IDS.hotel.simatupang)
    expect(rina.memberships.some(m => m.hotelRef === IDS.hotel.simatupang)).toBe(false)
    expect(adminReach(rina)).toEqual([IDS.hotel.kuningan])
  })

  it('reads the role from the membership at the SELECTED hotel, so it follows the switcher', () => {
    // useSession needs the Nuxt runtime, so this pins the rule it applies —
    // `memberships.find(hotelRef)?.role ?? 'staff'` — against the same payload
    // it would receive. Rina's standing changes with the hotel: admin at
    // Kuningan, plain staff at the grant-only Simatupang, and plain staff at
    // a hotel she has never heard of.
    const rina = loginStaff('regional@aston.example', 'regional123')
    expect(roleAt(rina, IDS.hotel.kuningan)).toBe('admin')
    expect(roleAt(rina, IDS.hotel.simatupang)).toBe('staff')
    expect(roleAt(rina, IDS.hotel.fave)).toBe('staff')
    // And the payload no longer carries an account-wide role to fall back on.
    expect('role' in rina).toBe(false)
    expect('hotels' in rina).toBe(false)
  })

  it('has a doorstep message that names both admitted roles', () => {
    expect(CONSOLE_DENIED_MESSAGE).toContain('property admins')
    expect(CONSOLE_DENIED_MESSAGE).toContain('operators')
  })
})
