<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { InboxIcon, KeyRoundIcon, MailIcon, WandSparklesIcon } from '@lucide/vue'
import { demoFollowApiLink, demoGoogleCallbackUrl, demoGoogleConsent, demoLogins, demoOutbox } from '~/utils/clientFakeApi'
import type { DemoGoogleIdentity, DemoMail } from '~/utils/clientFakeApi'
import { appPathFromLocation, authErrorNotice, buildReturnTo, safeRedirectPath, sessionEndedNotice } from '~/utils/sign-in'
import { useSession } from '~/composables/useSession'
import { CONSOLE_DENIED_MESSAGE, admitsRole, useConsoleAccess } from '~/composables/useConsoleAccess'

definePageMeta({ layout: false })

const route = useRoute()
const session = useSession()
const access = useConsoleAccess()
const runtimeConfig = useRuntimeConfig()

/**
 * Three ways in, all ending in the same st_session cookie: Google Sign-In,
 * an emailed link, and the password as the transition fallback. Neither
 * passwordless path can create an account, and none of them changes who this
 * console admits — the admission rule runs after every one of them.
 *
 * The passwordless paths are redirect-based: the API 302s the browser back to
 * THIS screen (the returnTo below) carrying either the cookie or
 * `?authError=`, so both outcomes land where the copy for them lives.
 */

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const busy = ref<'' | 'google' | 'link' | 'password'>('')
// The gate signs a turned-away account out and sends it here with the reason, so
// the refusal survives the redirect instead of vanishing with the session.
const errorMessage = ref(route.query.denied === 'console' ? CONSOLE_DENIED_MESSAGE : '')
const linkRequestedFor = ref('')

const redirectPath = computed(() => safeRedirectPath(route.query.redirect))
const returnTo = () => buildReturnTo(window.location.origin, runtimeConfig.app.baseURL, redirectPath.value)
const authNotice = computed(() => authErrorNotice(route.query.authError))
/** Why the user is back here when it was not their choice: `?reason=expired` from a forced sign-out. */
const endedNotice = computed(() => sessionEndedNotice(route.query.reason))

/**
 * Only the demo accounts this console admits. Offering `staff` or `leader` here
 * would be a one-tap route to a refusal — they belong on the staff workspace's
 * sign-in screen, which still lists every seeded account.
 */
const demos = ref<ReturnType<typeof demoLogins>>([])
onMounted(() => {
  demos.value = demoLogins().filter(demo => admitsRole(demo.role, demo.isOperator))
})

function autofill(demoEmail: string, pass: string) {
  email.value = demoEmail
  password.value = pass
  showPassword.value = true
  linkRequestedFor.value = ''
}

/**
 * Every sign-in path ends here. Staff and team leaders have no screen in this
 * console: refuse at the door and drop the session rather than signing them in
 * to an empty shell. An admissible account opens on a hotel it administers, or
 * on the platform screens for an operator.
 */
async function finishSignIn() {
  if (!access.isAdmissible.value) {
    await session.logout()
    errorMessage.value = CONSOLE_DENIED_MESSAGE
    return
  }
  if (!access.isOperator.value) {
    const first = access.adminHotels.value[0]
    if (first) session.setHotelId(first)
  }
  const fallback = access.isOperator.value ? '/platform' : '/'
  await navigateTo(redirectPath.value ?? fallback, { replace: true })
}

async function submitPassword() {
  if (busy.value) return
  errorMessage.value = ''
  busy.value = 'password'
  try {
    const result = await session.login({ email: email.value, password: password.value })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    await finishSignIn()
  }
  finally {
    busy.value = ''
  }
}

// ── Emailed sign-in link ─────────────────────────────────────────────────────

function magicLinkFailure(code: string, message: string) {
  switch (code) {
    case 'RATE_LIMITED': return 'Too many sign-in links requested for that address just now. Wait a few minutes, or use a password.'
    case 'UNAVAILABLE': return 'Email sign-in is not switched on for this deployment. Use another way in.'
    default: return message
  }
}

async function sendLink() {
  if (busy.value) return
  errorMessage.value = ''
  busy.value = 'link'
  try {
    const result = await session.requestMagicLink(email.value, returnTo())
    if (!result.ok) {
      errorMessage.value = magicLinkFailure(result.code, result.message)
      return
    }
    // 202 says "acted on", not "that account exists" — the copy below keeps it that way.
    linkRequestedFor.value = email.value.trim().toLowerCase()
    demoInbox.value = demoOutbox(linkRequestedFor.value)
  }
  finally {
    busy.value = ''
  }
}

/** Mock-only: the dev-console mail transport's outbox, in place of a mailbox. */
const demoInbox = ref<DemoMail[]>([])

// ── Google Sign-In ───────────────────────────────────────────────────────────

/** Mock-only: the account chooser standing in for Google's consent screen. */
const googleConsent = ref<ReturnType<typeof demoGoogleConsent>>(null)

/** Identities to offer: the admissible demo accounts, plus the two that exercise the refusals. */
const googleIdentities = computed(() => {
  const consent = googleConsent.value
  if (!consent) return []
  const admissible = new Set(demos.value.map(d => d.email))
  return consent.identities.filter(i => !i.hasAccount || admissible.has(i.email))
})

function googleFailure(code: string, message: string) {
  switch (code) {
    case 'UNAVAILABLE': return 'Google sign-in is not switched on for this deployment. Use another way in.'
    case 'RATE_LIMITED': return 'Too many sign-in attempts just now. Wait a moment and try again.'
    default: return message
  }
}

async function continueWithGoogle() {
  if (busy.value) return
  errorMessage.value = ''
  busy.value = 'google'
  try {
    const result = await session.googleSignInUrl(returnTo())
    if (!result.ok) {
      errorMessage.value = googleFailure(result.code, result.message)
      return
    }
    const consent = demoGoogleConsent(result.url)
    if (!consent) {
      // The real thing: a full-page navigation, never a fetch.
      window.location.assign(result.url)
      return
    }
    googleConsent.value = consent
  }
  finally {
    busy.value = ''
  }
}

async function chooseGoogleIdentity(choice: DemoGoogleIdentity | 'cancel') {
  const consent = googleConsent.value
  if (!consent) return
  googleConsent.value = null
  await followApiLink(demoGoogleCallbackUrl(consent, choice === 'cancel' ? 'cancel' : { email: choice.email }))
}

/**
 * Mock-only: what the browser would do with the API's 302. On success the
 * session id it carried is adopted where the cookie seam lives, identity is
 * recovered from GET /v1/auth/session, and the admission rule runs as it does
 * for a password. On failure the app lands on the Location, which is this
 * screen carrying `?authError=`.
 */
async function followApiLink(url: string) {
  errorMessage.value = ''
  const { location, sessionCookie } = demoFollowApiLink(url)
  if (sessionCookie) {
    await session.adoptCookieSession(sessionCookie)
    await finishSignIn()
    return
  }
  const path = appPathFromLocation(location, window.location.origin, runtimeConfig.app.baseURL)
  await navigateTo(path ?? '/', { replace: true })
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <AppLogo class="mb-2 size-12 text-primary" />
        <CardTitle class="text-2xl tracking-tight">Sentec Tasks</CardTitle>
        <CardDescription>Admin and operator console.</CardDescription>
      </CardHeader>

      <CardContent class="space-y-5">
        <Alert v-if="authNotice" :variant="authNotice.cancelled ? 'default' : 'destructive'">
          <AlertTitle>{{ authNotice.title }}</AlertTitle>
          <AlertDescription>{{ authNotice.message }}</AlertDescription>
        </Alert>
        <!-- The session ended (401, or unknown on reload) and the app signed out. -->
        <Alert v-else-if="endedNotice">
          <AlertTitle>{{ endedNotice.title }}</AlertTitle>
          <AlertDescription>{{ endedNotice.message }}</AlertDescription>
        </Alert>

        <Button class="w-full" variant="outline" type="button" :disabled="Boolean(busy)" @click="continueWithGoogle">
          <svg class="size-4" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {{ busy === 'google' ? 'Opening Google…' : 'Continue with Google' }}
        </Button>

        <div class="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
          <Separator class="flex-1" />
          <span>or with your email</span>
          <Separator class="flex-1" />
        </div>

        <div v-if="linkRequestedFor" class="space-y-3">
          <Alert>
            <MailIcon class="size-4" />
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              If <span class="font-medium text-foreground">{{ linkRequestedFor }}</span> belongs to an active
              account, a sign-in link is on its way. It works once and expires in 15 minutes.
            </AlertDescription>
          </Alert>

          <div v-if="demoInbox.length" class="space-y-2 rounded-lg border border-dashed p-3">
            <p class="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <InboxIcon class="size-3.5" />
              Demo inbox
            </p>
            <p class="text-xs text-muted-foreground">
              This demo prints the email to the browser console instead of sending it, the way the API's
              dev mail transport does. Open it here:
            </p>
            <Button
              v-for="mail in demoInbox"
              :key="mail.link"
              type="button"
              variant="secondary"
              size="sm"
              class="w-full justify-start text-xs"
              @click="followApiLink(mail.link)"
            >
              <MailIcon class="size-3" />
              <span class="truncate">{{ mail.subject }}</span>
            </Button>
          </div>

          <Button variant="ghost" size="sm" class="w-full" type="button" @click="linkRequestedFor = ''">
            Use a different address
          </Button>
        </div>

        <form v-else class="space-y-4" @submit.prevent="showPassword ? submitPassword() : sendLink()">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              v-model="email"
              type="email"
              class="w-full"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="you@property.example"
              required
            />
          </div>

          <div v-if="showPassword" class="space-y-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="password"
              type="password"
              class="w-full"
              autocomplete="current-password"
              placeholder="Enter password"
            />
          </div>

          <Alert v-if="errorMessage" variant="destructive">
            <AlertTitle>Couldn't sign in</AlertTitle>
            <AlertDescription>{{ errorMessage }}</AlertDescription>
          </Alert>

          <template v-if="showPassword">
            <Button class="w-full" type="submit" :disabled="Boolean(busy)">
              {{ busy === 'password' ? 'Signing in…' : 'Sign In' }}
            </Button>
            <!-- The API keeps password login only as the transition fallback. -->
            <p class="text-center text-xs text-muted-foreground">
              Passwords are being phased out. The emailed link and Google work for every active account.
            </p>
            <Button variant="ghost" size="sm" class="w-full" type="button" @click="showPassword = false">
              <MailIcon class="size-3.5" />
              Email me a sign-in link instead
            </Button>
          </template>
          <template v-else>
            <Button class="w-full" type="submit" :disabled="Boolean(busy)">
              <MailIcon class="size-4" />
              {{ busy === 'link' ? 'Sending…' : 'Email me a sign-in link' }}
            </Button>
            <Button variant="ghost" size="sm" class="w-full" type="button" @click="showPassword = true">
              <KeyRoundIcon class="size-3.5" />
              Use a password instead
            </Button>
          </template>
        </form>
      </CardContent>

      <CardFooter>
        <div class="w-full space-y-2 rounded-lg border bg-muted/50 p-3">
          <p class="text-xs font-semibold text-muted-foreground">Demo accounts</p>
          <div class="grid grid-cols-2 gap-2">
            <Button
              v-for="demo in demos"
              :key="demo.email"
              type="button"
              variant="outline"
              size="sm"
              class="justify-start text-xs"
              @click="autofill(demo.email, demo.password)"
            >
              <WandSparklesIcon class="size-3" />
              <span class="truncate">{{ demo.name }}</span>
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>

    <!-- Mock-only: Google's account chooser. A real deployment navigates to Google instead. -->
    <Dialog :open="googleConsent !== null" @update:open="open => { if (!open) chooseGoogleIdentity('cancel') }">
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Choose an account</DialogTitle>
          <DialogDescription>
            Standing in for Google's consent screen. Only an address that belongs to an active staff
            account signs in — nothing is created.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-1">
          <Button
            v-for="identity in googleIdentities"
            :key="identity.email"
            type="button"
            variant="ghost"
            class="h-auto w-full justify-start px-2 py-2 text-left"
            @click="chooseGoogleIdentity(identity)"
          >
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
              {{ identity.name.slice(0, 1) }}
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm">{{ identity.name }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ identity.email }}</span>
            </span>
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" @click="chooseGoogleIdentity('cancel')">Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
