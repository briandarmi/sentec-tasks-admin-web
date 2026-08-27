import { computed } from 'vue'
import { useSession } from '~/composables/useSession'
import type { SessionUser } from '~/utils/clientFakeApi'

/**
 * Who this console is for: property admins and Sentinel Tech operators.
 *
 * Staff and team leaders have no screen here — every route either configures a
 * property or provisions the platform — so an account with neither reach is
 * refused at the door rather than signed in to an empty shell. That is a
 * courtesy, not security: the API enforces the same rules and is the only thing
 * standing between a caller and the data.
 *
 * Deliberately has no counterpart in the staff workspace: that app admits every
 * role, so "admissible" means something different there. `useCaps()` still
 * describes the full role model, and both apps carry their own copy of it.
 *
 * The two rules below are plain functions over a session payload rather than
 * composables, so they can be tested against the mock's real demo accounts
 * without a Nuxt runtime. See `tests/console-access.spec.ts`.
 */

/** The part of a session these rules read. */
type Reach = Pick<SessionUser, 'isOperator' | 'tenants'>

/**
 * Properties whose configuration an account may reach. Operators act as admin
 * everywhere, so they reach all of them. A group grant already resolves to the
 * admin role, so a regional manager is included without a special case.
 */
export function adminReach<T extends Reach>(user: T): T['tenants'] {
  return user.isOperator ? user.tenants : user.tenants.filter(tenant => tenant.role === 'admin')
}

/**
 * May this account use the console at all? Account-wide, not per property:
 * admin at one property is enough to get in, and the gate then moves the active
 * property to one that account administers.
 */
export function admitsToConsole(user: Reach): boolean {
  return user.isOperator || adminReach(user).length > 0
}

export function useConsoleAccess() {
  const session = useSession()

  const isOperator = computed(() => session.isOperator.value)
  const reach = computed<Reach>(() => ({
    isOperator: isOperator.value,
    tenants: session.tenants.value,
  }))

  const adminTenants = computed(() => adminReach(reach.value))
  const isAdmissible = computed(() => admitsToConsole(reach.value))

  return { isOperator, adminTenants, isAdmissible }
}

/**
 * Whether a single role string names someone this console admits.
 *
 * A narrower question than `admitsToConsole()`, which weighs a whole session's
 * reach. This exists for `demoLogins()`, which reports one role per account —
 * operator, or the role on its first active profile — and so is only a proxy for
 * the real rule. `tests/console-access.spec.ts` pins the two to the same answer,
 * so a seed that makes them disagree fails there rather than on the screen.
 *
 * Deliberately not importing the mock here: this module is pulled in by the
 * route middleware, and a value import of `clientFakeApi` would drag the whole
 * 56K mock into that chunk eagerly, where `useSession` is careful to load it
 * only at call time.
 */
export function admitsRole(role: string): boolean {
  return role === 'admin' || role === 'operator'
}

/** Shown on the login screen when an account is turned away. */
export const CONSOLE_DENIED_MESSAGE
  = 'This console is for property admins and Sentinel Tech operators. Your account is neither at any property you can reach — the staff workspace is where your work lives.'
