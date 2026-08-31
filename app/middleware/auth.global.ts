import { useSession } from '~/composables/useSession'
import { useConsoleAccess } from '~/composables/useConsoleAccess'

/**
 * Auth and role gate.
 *
 * Two roles reach this console: property `admin` and platform `operator`. Staff
 * and team leaders do not — there is no screen here for someone who works a
 * queue rather than configures one — so a session with neither is signed out and
 * sent back to the login screen with the reason.
 *
 * Routes are flat, so the operator gate is an explicit list rather than a path
 * prefix. That is the trade the flat URLs buy: adding a platform screen means
 * adding it below, and forgetting to leaves it reachable by any admin, which is
 * the direction that fails visibly rather than silently.
 *
 * These redirects are a courtesy — they keep someone from landing on a screen
 * that can only render an error — but the API is what actually refuses the data,
 * so a hand-typed URL gains nothing.
 */

/** Sentinel Tech platform provisioning. Operator flag on the user. */
const OPERATOR_ROUTES = new Set([
  '/platform',
  '/properties',
  '/groups',
  '/partners',
])

export default defineNuxtRouteMiddleware(async (to) => {
  // The design-system preview is deliberately public — no login, in dev and in
  // production alike. It renders component specimens against static props and
  // touches no session, no tenant and no API, so there is nothing behind it to
  // protect. It is meant to be linkable to anyone working on the brand.
  //
  // Worth knowing before treating this as a hole: these consoles are static
  // SPAs (`ssr: false`), so every page's code already ships to any visitor who
  // loads the bundle. This middleware is a UX redirect, not a security
  // boundary — the API is what actually refuses data.
  if (to.path === '/design-system')
    return

  const session = useSession()
  const access = useConsoleAccess()

  // Checked before the /login branch so a turned-away account is shown the door
  // once, rather than bounced to '/' and back.
  if (session.isAuthenticated.value && !access.isAdmissible.value) {
    await session.logout()
    if (to.path === '/login') return
    return navigateTo({ path: '/login', query: { denied: 'console' } })
  }

  if (to.path === '/login') {
    return session.isAuthenticated.value ? navigateTo('/') : undefined
  }

  if (!session.isAuthenticated.value) {
    // Come back here after signing in rather than dumping the user on the
    // overview — a deep link is usually why they were sent to /login.
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } })
  }

  /**
   * Land on a property this account actually administers. The session picks the
   * first property it can reach, which for someone who is admin at one and staff
   * at another can be the one with nothing to configure.
   */
  if (!access.isOperator.value && session.activeTenant.value?.role !== 'admin') {
    const first = access.adminTenants.value[0]
    if (first) session.setTenantId(first.id)
  }

  if (OPERATOR_ROUTES.has(to.path)) {
    // An admin who types a platform URL goes to the overview, which they can
    // read — not to a dead end.
    return session.isOperator.value ? undefined : navigateTo('/')
  }

  /**
   * Everything else configures a property, which needs admin at the active one
   * or an operator. Admissibility is settled above and the active property was
   * just corrected, so this is a backstop; signing out is how it fails, because
   * redirecting an authenticated user to '/login' would only bounce back.
   */
  const role = session.role.value
  if (role !== 'admin' && role !== 'operator') {
    await session.logout()
    return navigateTo({ path: '/login', query: { denied: 'console' } })
  }
})
