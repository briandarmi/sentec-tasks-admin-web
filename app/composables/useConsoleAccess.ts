import { computed } from 'vue'
import { useSession } from '~/composables/useSession'
import type { Staff } from '~/utils/clientFakeApi'

/**
 * Who this console is for: property admins and Sentinel Tech operators.
 *
 * The real API's role is ACCOUNT-WIDE — one of staff/leader/admin — plus an
 * isOperator flag. Staff and team leaders have no screen here, so an account
 * that is not an admin is refused at the door rather than signed in to an
 * empty shell. That is a courtesy, not security: the API enforces the same
 * rules and is the only thing standing between a caller and the data.
 *
 * An operator is a special admissible case: their account carries role admin
 * with an EMPTY hotels claim, so every hotel-scoped route refuses them — they
 * get the platform screens, never the property screens. A property admin gets
 * the reverse.
 *
 * The rules are plain functions over the session's staff payload so they can be
 * tested against the mock's real demo accounts without a Nuxt runtime. See
 * `tests/console-access.spec.ts`.
 */

/** The part of a session these rules read. */
type Reach = Pick<Staff, 'role' | 'isOperator' | 'hotels'>

/** Hotels whose configuration an account may reach: admins with a claim only. */
export function adminReach(user: Reach): string[] {
  if (user.isOperator) return [] // hotel-scoped routes refuse operators
  return user.role === 'admin' ? user.hotels : []
}

/**
 * May this account use the console at all? An operator (platform screens), or
 * an admin with at least one hotel in their claim (property screens).
 */
export function admitsToConsole(user: Reach): boolean {
  return user.isOperator || adminReach(user).length > 0
}

export function useConsoleAccess() {
  const session = useSession()

  const isOperator = computed(() => session.isOperator.value)
  const reach = computed<Reach>(() => ({
    role: session.role.value ?? 'staff',
    isOperator: isOperator.value,
    hotels: session.staff.value?.hotels ?? [],
  }))

  const adminHotels = computed(() => adminReach(reach.value))
  const isAdmissible = computed(() => admitsToConsole(reach.value))

  return { isOperator, adminHotels, isAdmissible }
}

/**
 * Whether a role/operator pair names someone this console admits — the shape
 * `demoLogins()` reports. `tests/console-access.spec.ts` pins this proxy to the
 * real `admitsToConsole` answer for every seeded account, so a seed that makes
 * them disagree fails there rather than quietly hiding a working account.
 *
 * Deliberately not importing the mock here: this module is pulled in by the
 * route middleware, and a value import of `clientFakeApi` would drag the whole
 * mock into that chunk eagerly, where `useSession` loads it only at call time.
 */
export function admitsRole(role: string, isOperator: boolean): boolean {
  return isOperator || role === 'admin'
}

/** Shown on the login screen when an account is turned away. */
export const CONSOLE_DENIED_MESSAGE
  = 'This console is for property admins and Sentinel Tech operators. Your account is neither — the staff workspace is where your work lives.'
