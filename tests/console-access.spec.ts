import { describe, expect, it } from 'vitest'
import { demoLogins, handleFakeApiRequest } from '~/utils/clientFakeApi'
import { adminReach, admitsRole, admitsToConsole } from '~/composables/useConsoleAccess'

/**
 * Who gets into the admin console.
 *
 * Asserted against the mock's real demo accounts rather than hand-built
 * fixtures, so a change to the seeded role model or to how group grants resolve
 * fails here instead of at someone's login screen.
 */

function signIn(username: string, password: string) {
  const res = handleFakeApiRequest('/v1/auth/login', {
    method: 'POST',
    body: { username, password },
  }) as { data: { user: { isOperator: boolean, tenants: Array<{ id: string, name: string, role: string | null, viaGroupGrant: boolean }> } } }
  return res.data.user as Parameters<typeof admitsToConsole>[0]
}

describe('admitsToConsole', () => {
  it('admits a property admin', () => {
    expect(admitsToConsole(signIn('admin', 'admin123'))).toBe(true)
  })

  it('admits a Sentinel Tech operator', () => {
    expect(admitsToConsole(signIn('operator', 'operator123'))).toBe(true)
  })

  it('admits a regional manager, counting group-granted properties as admin reach', () => {
    // This account holds both shapes: a direct admin profile at one property and
    // a group grant at another. The grant is the path worth pinning — it is the
    // only way admin reach arrives without a staff profile behind it.
    const user = signIn('regional', 'regional123')
    expect(admitsToConsole(user)).toBe(true)
    expect(adminReach(user).some(t => t.viaGroupGrant)).toBe(true)
    expect(adminReach(user).some(t => !t.viaGroupGrant)).toBe(true)
  })

  it('refuses a team leader', () => {
    expect(admitsToConsole(signIn('leader', 'leader123'))).toBe(false)
  })

  it('refuses staff', () => {
    expect(admitsToConsole(signIn('staff', 'staff123'))).toBe(false)
  })

  it('covers every login the mock seeds', () => {
    // Guards against a newly seeded account slipping past this file untested.
    const covered = new Set(['admin', 'operator', 'regional', 'leader', 'staff'])
    expect(demoLogins().map(d => d.username).filter(u => !covered.has(u))).toEqual([])
  })
})

describe('the demo logins the sign-in screen offers', () => {
  /**
   * The screen filters on `admitsRole(demo.role)`, a one-role proxy for the real
   * admission rule. This is what keeps the proxy honest: every seeded account is
   * signed in for real, and the two answers must agree. A seed where someone's
   * first active profile is staff but who is admin elsewhere would break the
   * proxy — and fail here rather than by hiding a working account.
   */
  it('agrees with the real admission rule, account by account', () => {
    for (const demo of demoLogins()) {
      expect(
        admitsRole(demo.role),
        `${demo.username} (role ${demo.role})`,
      ).toBe(admitsToConsole(signIn(demo.username, demo.password)))
    }
  })

  it('offers admin, operator and regional, and not staff or leader', () => {
    const offered = demoLogins().filter(d => admitsRole(d.role)).map(d => d.username).sort()
    expect(offered).toEqual(['admin', 'operator', 'regional'])
  })
})

describe('adminReach', () => {
  it('is every active property for an operator', () => {
    const user = signIn('operator', 'operator123')
    expect(adminReach(user)).toEqual(user.tenants)
    expect(adminReach(user).length).toBeGreaterThan(1)
  })

  it('drops properties where the account is only staff', () => {
    // The mixed case the gate exists for — admin at one property, staff at
    // another — is not in the seed data, so it is spelled out here. This is the
    // shape that made the gate move the active property: the session would
    // otherwise open on a property with nothing to configure.
    const mixed = {
      isOperator: false,
      tenants: [
        { id: '1', name: 'Aston Simatupang', role: 'staff' as const, viaGroupGrant: false },
        { id: '2', name: 'Aston Kuningan Suites', role: 'admin' as const, viaGroupGrant: false },
      ],
    }
    expect(admitsToConsole(mixed)).toBe(true)
    expect(adminReach(mixed).map(t => t.id)).toEqual(['2'])
  })

  it('is empty for an account with no admin role anywhere', () => {
    expect(adminReach(signIn('staff', 'staff123'))).toEqual([])
  })
})
