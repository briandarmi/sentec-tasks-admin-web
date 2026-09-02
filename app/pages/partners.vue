<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { CheckIcon, CopyIcon, KeyRoundIcon, PlugZapIcon, PlusIcon, TriangleAlertIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Partner, SourceApp } from '~/utils/clientFakeApi'
import { relativeTime } from '~/utils/task-ui'

/**
 * Integration partners in the real API: registered with a name, issued a
 * secret exactly once, and controlled by ONE switch — isActive. There is no
 * rotate-secret route: revocation IS deactivation (verified per request, no
 * caching), and a new secret means registering a new partner.
 */
const api = useTasksApi()

const partners = ref<Partner[]>([])
const sourceApps = ref<SourceApp[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const createOpen = ref(false)
const formName = ref('')

/**
 * The one and only time a secret is visible. It is encrypted at rest and no
 * route can ever return it again, so this panel stays up until dismissed.
 */
const revealed = ref<{ name: string, secret: string } | null>(null)
const copied = ref(false)
/** Deactivation cuts every token the partner holds, instantly — confirm it. */
const toggleTarget = ref<Partner | null>(null)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedPartners, loadedApps] = await Promise.all([api.listPartners(), api.listSourceApps()])
    partners.value = loadedPartners
    sourceApps.value = loadedApps
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreate() {
  formName.value = ''
  formError.value = ''
  createOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    const created = await api.registerPartner(formName.value.trim())
    createOpen.value = false
    revealed.value = { name: created.name, secret: created.secret }
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function confirmToggle() {
  const target = toggleTarget.value
  if (!target || isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await api.setPartnerActive(target.id, !target.isActive)
    toggleTarget.value = null
    await load()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function copySecret() {
  if (!revealed.value) return
  try {
    await navigator.clipboard.writeText(revealed.value.secret)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
  catch {
    // Clipboard can be blocked by permissions; the value is selectable on screen.
    copied.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Integration partners"
      description="Applications allowed to dispatch tasks over their own individually-revocable tokens."
      :icon="PlugZapIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          Register partner
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div
      v-if="revealed"
      class="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
    >
      <div class="flex items-start gap-3">
        <KeyRoundIcon class="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div class="min-w-0 flex-1 space-y-3">
          <div>
            <p class="text-sm font-bold text-foreground">Secret for {{ revealed.name }}</p>
            <p class="text-xs text-muted-foreground">
              This is the only time it will be shown. It is encrypted at rest and cannot be read back.
              There is no rotation route — a compromised secret means deactivating this partner and registering a new one.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <code class="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs">{{ revealed.secret }}</code>
            <Button size="sm" variant="outline" @click="copySecret">
              <CheckIcon v-if="copied" />
              <CopyIcon v-else />
              {{ copied ? 'Copied' : 'Copy' }}
            </Button>
            <Button size="sm" variant="ghost" @click="revealed = null">Done</Button>
          </div>
        </div>
      </div>
    </div>

    <TableSkeleton v-if="isLoading && partners.length === 0" :rows="4" :columns="3" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="partner in partners" :key="partner.id">
                <TableCell class="font-medium text-foreground">{{ partner.name }}</TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">{{ relativeTime(partner.createdAt) }}</TableCell>
                <TableCell>
                  <Badge :variant="partner.isActive ? 'success' : 'secondary'">
                    {{ partner.isActive ? 'Active' : 'Deactivated' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right">
                  <Button size="sm" variant="outline" @click="toggleTarget = partner">
                    {{ partner.isActive ? 'Deactivate' : 'Reactivate' }}
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && partners.length === 0">
                <TableCell colspan="4" class="py-10 text-center text-sm text-muted-foreground">
                  No partners registered. Tasks still works standalone — partners are only needed to accept work from another app.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- The platform-wide source-app registry: what badges every task with the
         app it came from. Readable by every authenticated user; curated here. -->
    <Card class="rounded-xl">
      <CardHeader class="pb-2">
        <CardTitle class="text-base font-semibold">Source-app registry</CardTitle>
        <CardDescription>
          Resolves a task's source code to a name and badge colour, product-wide.
          An unregistered code still creates tasks — it just renders unbadged.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap gap-2">
        <span
          v-for="app in sourceApps"
          :key="app.code"
          class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-foreground"
          :class="app.isActive ? '' : 'opacity-55'"
        >
          <span
            v-if="app.color"
            class="h-2 w-2 rounded-full"
            :style="{ backgroundColor: app.color }"
            aria-hidden="true"
          />
          {{ app.name }}
          <span class="font-mono text-[10px] text-muted-foreground">{{ app.code }}</span>
        </span>
      </CardContent>
    </Card>

    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register partner</DialogTitle>
          <DialogDescription>Issues the JWT secret the application signs its own tokens with.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not register</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="partner-name">Name</Label>
            <Input id="partner-name" v-model="formName" placeholder="e.g. Sentec PMS" />
          </div>
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>The secret is shown once</AlertTitle>
            <AlertDescription>Copy it before closing the panel. It cannot be retrieved or rotated later — only replaced by a new registration.</AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="createOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formName.trim()" @click="save">
            {{ isSaving ? 'Registering…' : 'Register' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(toggleTarget)" @update:open="value => { if (!value) toggleTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ toggleTarget?.isActive ? `Deactivate ${toggleTarget?.name}?` : `Reactivate ${toggleTarget?.name}?` }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="toggleTarget?.isActive">
              Every token this partner has issued stops verifying the moment this completes — the check runs
              per request, nothing is cached. It can dispatch nothing until reactivated.
            </template>
            <template v-else>
              Its existing secret starts verifying again immediately.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="isSaving" @click.prevent="confirmToggle">
            {{ isSaving ? 'Working…' : toggleTarget?.isActive ? 'Deactivate' : 'Reactivate' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
