<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlugZapIcon,
  PlusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { SourceApp } from '~/utils/clientFakeApi'
import { relativeTime } from '~/utils/task-ui'
import { SELECT_EMPTY, fromSelectValue } from '~/utils/select-empty'

const api = useTasksApi()

const partners = ref<Awaited<ReturnType<typeof api.listPartners>>>([])
/** The platform-wide source-app registry: what a partner dispatches AS. */
const sourceApps = ref<SourceApp[]>([])
const sourceAppByCode = computed(() => new Map(sourceApps.value.map(app => [app.code, app])))
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const createOpen = ref(false)
const formName = ref('')
const formKind = ref('')
/** SELECT_EMPTY = not mapped; tasks from this partner then badge by name only. */
const formSourceApp = ref(SELECT_EMPTY)

/**
 * The one and only time a secret is visible.
 *
 * It is AES-256-GCM encrypted at rest and cannot be read back — only rotated.
 * So this panel stays up until dismissed, and says clearly that closing it
 * loses the value.
 */
const revealed = ref<{ name: string, secret: string, rotated: boolean } | null>(null)
const copied = ref(false)
const rotateTarget = ref<{ id: string, name: string } | null>(null)

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
  formKind.value = ''
  formSourceApp.value = SELECT_EMPTY
  formError.value = ''
  createOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    const created = await api.createPartner({
      name: formName.value.trim(),
      kind: formKind.value.trim() || undefined,
      sourceAppCode: fromSelectValue(formSourceApp.value),
    })
    createOpen.value = false
    if (created.secretPreview) {
      revealed.value = { name: created.name, secret: created.secretPreview, rotated: false }
    }
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function confirmRotate() {
  const target = rotateTarget.value
  if (!target || isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    const rotated = await api.rotatePartnerSecret(target.id)
    rotateTarget.value = null
    if (rotated.secretPreview) {
      revealed.value = { name: rotated.name, secret: rotated.secretPreview, rotated: true }
    }
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
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Integration partners"
      description="Applications allowed to dispatch tasks into Sentec Tasks."
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
            <p class="text-sm font-bold text-foreground">
              {{ revealed.rotated ? 'New secret for' : 'Secret for' }} {{ revealed.name }}
            </p>
            <p class="text-xs text-muted-foreground">
              This is the only time it will be shown. It is encrypted at rest and cannot be read back — only rotated.
              <template v-if="revealed.rotated">The previous secret stops working immediately.</template>
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

    <TableSkeleton v-if="isLoading && partners.length === 0" :rows="4" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead>Source app</TableHead>
                <TableHead>Tasks dispatched</TableHead>
                <TableHead>Last dispatch</TableHead>
                <TableHead>Event delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="partner in partners" :key="partner.id">
                <TableCell>
                  <p class="font-medium text-foreground">{{ partner.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ partner.kind }}</p>
                </TableCell>
                <TableCell>
                  <!-- The registry colour is data from the platform, not a theme
                       token — it must match the badge every client renders. -->
                  <span
                    v-if="partner.sourceAppCode && sourceAppByCode.get(partner.sourceAppCode)"
                    class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-foreground"
                  >
                    <span
                      class="h-2 w-2 rounded-full"
                      :style="{ backgroundColor: sourceAppByCode.get(partner.sourceAppCode)!.badgeColor }"
                    />
                    {{ sourceAppByCode.get(partner.sourceAppCode)!.name }}
                  </span>
                  <span v-else class="text-xs text-muted-foreground">Not mapped</span>
                </TableCell>
                <TableCell class="tabular-nums text-foreground">{{ partner.taskCount }}</TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">
                  {{ partner.lastDispatchAt ? relativeTime(partner.lastDispatchAt) : 'Never' }}
                </TableCell>
                <TableCell>
                  <!-- Undelivered events are the operationally interesting
                       number: the partner is not learning about progress. -->
                  <Badge v-if="partner.undeliveredEventCount > 0" variant="destructive" class="tabular-nums">
                    {{ partner.undeliveredEventCount }} stuck
                  </Badge>
                  <Badge v-else variant="outline">Up to date</Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="partner.isActive ? 'success' : 'secondary'">
                    {{ partner.isActive ? 'Active' : 'Inactive' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    @click="rotateTarget = { id: partner.id, name: partner.name }"
                  >
                    <RotateCwIcon />
                    Rotate secret
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && partners.length === 0">
                <TableCell colspan="7" class="py-10 text-center text-sm text-muted-foreground">
                  No partners registered. Tasks still works standalone — partners are only needed to accept work from another app.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register partner</DialogTitle>
          <DialogDescription>Issues a JWT secret the application uses to dispatch tasks.</DialogDescription>
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
          <div class="space-y-2">
            <Label for="partner-kind">What it is</Label>
            <Input id="partner-kind" v-model="formKind" placeholder="e.g. Property management" />
          </div>
          <div class="space-y-2">
            <Label>Source app</Label>
            <Select v-model="formSourceApp">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Not mapped" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="SELECT_EMPTY">Not mapped</SelectItem>
                <SelectItem v-for="app in sourceApps.filter(a => a.isActive)" :key="app.code" :value="app.code">
                  {{ app.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              The registry entry this partner dispatches as — it decides the badge on every task it raises.
            </p>
          </div>
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>The secret is shown once</AlertTitle>
            <AlertDescription>Copy it before closing the panel. It cannot be retrieved later, only rotated.</AlertDescription>
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

    <AlertDialog :open="Boolean(rotateTarget)" @update:open="value => { if (!value) rotateTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rotate {{ rotateTarget?.name }}'s secret?</AlertDialogTitle>
          <AlertDialogDescription>
            The current secret stops working the moment this completes, so that application cannot dispatch
            tasks until it is updated with the new one. Have someone ready to deploy it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="isSaving" @click="confirmRotate">
            {{ isSaving ? 'Rotating…' : 'Rotate secret' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
