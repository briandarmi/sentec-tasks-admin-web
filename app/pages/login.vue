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

const username = ref('')
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
  demos.value = demoLogins().filter(demo => admitsRole(demo.role))
})

function autofill(user: string, pass: string) {
  username.value = user
  password.value = pass
}

async function submit() {
  if (isSubmitting.value) return
  errorMessage.value = ''
  isSubmitting.value = true
  try {
    const result = await session.login({ username: username.value, password: password.value })
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

    // Open on a property this account administers, not merely the first one it
    // can reach — those differ for an admin who is also staff elsewhere.
    if (!access.isOperator.value) {
      const first = access.adminTenants.value[0]
      if (first) session.setTenantId(first.id)
    }

    // Honour a deep link that bounced through the auth gate.
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
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
            <Label for="username">Username</Label>
            <Input
              id="username"
              v-model="username"
              class="w-full"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              placeholder="Enter username"
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
              :key="demo.username"
              type="button"
              variant="outline"
              size="sm"
              class="justify-start text-xs"
              @click="autofill(demo.username, demo.password)"
            >
              <WandSparklesIcon class="size-3" />
              <span class="truncate capitalize">{{ demo.username }}</span>
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  </div>
</template>
