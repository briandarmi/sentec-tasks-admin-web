<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { WandSparklesIcon } from '@lucide/vue'
import { demoLogins } from '~/utils/clientFakeApi'
import { useSession } from '~/composables/useSession'
import { CONSOLE_DENIED_MESSAGE, admitsRole, useConsoleAccess } from '~/composables/useConsoleAccess'

definePageMeta({ layout: false })

const route = useRoute()
const session = useSession()
const access = useConsoleAccess()

const email = ref('')
const password = ref('')
const isSubmitting = ref(false)
// The gate signs a turned-away account out and sends it here with the reason, so
// the refusal survives the redirect instead of vanishing with the session.
const errorMessage = ref(route.query.denied === 'console' ? CONSOLE_DENIED_MESSAGE : '')

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
}

async function submit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const result = await session.login({ email: email.value, password: password.value })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }

    // Staff and team leaders have no screen here. Refuse at the door and drop
    // the session rather than signing them in to an empty console.
    if (!access.isAdmissible.value) {
      await session.logout()
      errorMessage.value = CONSOLE_DENIED_MESSAGE
      return
    }

    // Open on a hotel this account administers; an operator has none and
    // lands on the platform screens instead.
    if (!access.isOperator.value) {
      const first = access.adminHotels.value[0]
      if (first) session.setHotelId(first)
    }

    // Honour a deep link that bounced through the auth gate.
    const fallback = access.isOperator.value ? '/platform' : '/'
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : fallback
    await navigateTo(redirect)
  }
  finally {
    isSubmitting.value = false
  }
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

      <CardContent>
        <form class="space-y-5" @submit.prevent="submit">
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
            />
          </div>

          <div class="space-y-2">
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

          <Button class="w-full" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Signing in…' : 'Sign In' }}
          </Button>
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
  </div>
</template>
