<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ClockIcon, HotelIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { TenantSettings } from '~/composables/useTasksApi'
import { useTenant } from '~/composables/useTenant'

/**
 * The property's own record (GET /v1/tenant) and its one editable field: the
 * time zone (PATCH /v1/tenant, admin at the hotel). Every clock time in both
 * consoles is shown in this zone, operating schedules are read in it, and
 * every active template's next run is computed in it — so changing it moves
 * all of those at once, while tasks that already exist keep their due dates.
 * That is why the save goes through a confirmation, not a switch.
 */
const api = useTasksApi()
const tenantStore = useTenant()

interface ZoneOption { value: string, label: string }

/** The zones the property list actually spans, Indonesia first. Anything else is typed. */
const ZONES: ZoneOption[] = [
  { value: 'Asia/Jakarta', label: 'Asia/Jakarta — WIB, western Indonesia' },
  { value: 'Asia/Makassar', label: 'Asia/Makassar — WITA, central Indonesia' },
  { value: 'Asia/Jayapura', label: 'Asia/Jayapura — WIT, eastern Indonesia' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Asia/Kuala_Lumpur', label: 'Asia/Kuala_Lumpur' },
  { value: 'Asia/Bangkok', label: 'Asia/Bangkok' },
  { value: 'Asia/Ho_Chi_Minh', label: 'Asia/Ho_Chi_Minh' },
  { value: 'Asia/Manila', label: 'Asia/Manila' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Australia/Perth', label: 'Australia/Perth' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'UTC', label: 'UTC' },
]
const OTHER = '__other'

const tenant = ref<TenantSettings | null>(null)
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')
const savedNotice = ref('')

/** The picker's value: a curated zone, or OTHER with the name typed below. */
const pick = ref<string>(ZONES[0]!.value)
const customZone = ref('')
const confirmOpen = ref(false)

/** What would be saved. */
const chosenZone = computed(() => (pick.value === OTHER ? customZone.value.trim() : pick.value))

function isKnownZone(zone: string) {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  }
  catch {
    return false
  }
}

const zoneInvalid = computed(() => Boolean(chosenZone.value) && !isKnownZone(chosenZone.value))
const isDirty = computed(() => Boolean(tenant.value) && chosenZone.value !== tenant.value?.timezone)
const canSave = computed(() => !isSaving.value && isDirty.value && Boolean(chosenZone.value) && !zoneInvalid.value)

// ── Live clock in the chosen zone ─────────────────────────────────────────────

const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function clockIn(zone: string) {
  if (!isKnownZone(zone)) return null
  try {
    const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(nowMs.value)
    const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(nowMs.value).find(part => part.type === 'timeZoneName')?.value
    return { time, offset: offsetPart ?? '' }
  }
  catch {
    return null
  }
}

const currentClock = computed(() => (tenant.value ? clockIn(tenant.value.timezone) : null))
const chosenClock = computed(() => clockIn(chosenZone.value))

function adoptIntoForm(next: TenantSettings) {
  tenant.value = next
  if (ZONES.some(zone => zone.value === next.timezone)) {
    pick.value = next.timezone
    customZone.value = ''
  }
  else {
    pick.value = OTHER
    customZone.value = next.timezone
  }
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const loaded = await api.getTenant()
    adoptIntoForm(loaded)
    // Keep the shared record (and the display zone) in step with what was just read.
    tenantStore.adopt(loaded)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function requestSave() {
  if (!canSave.value) return
  formError.value = ''
  confirmOpen.value = true
}

async function save() {
  confirmOpen.value = false
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  savedNotice.value = ''
  try {
    const result = await api.setTenantTimezone(chosenZone.value)
    adoptIntoForm(result)
    tenantStore.adopt(result)
    savedNotice.value = `${result.name} now keeps time in ${result.timezone}. Operating schedules and active templates follow it from now on; existing tasks kept their due dates.`
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

// Picking a different zone clears an old notice, so the screen never says
// "saved" beside an unsaved change. Guarded on dirtiness: the save itself
// re-syncs the form, which would otherwise wipe the notice it just set.
watch(chosenZone, () => {
  if (isDirty.value) savedNotice.value = ''
})

onMounted(() => {
  void load()
  ticker = setInterval(() => { nowMs.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Property"
      description="This property's record and the time zone every clock time, schedule and template run is read in."
      :icon="HotelIcon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Could not load the property</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="secondary" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <TableSkeleton v-else-if="isLoading && !tenant" :rows="3" :columns="2" />

    <template v-else-if="tenant">
      <Card class="rounded-xl">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold">{{ tenant.name }}</CardTitle>
          <CardDescription>Provisioned by Sentinel Tech; the name and reference are not edited here.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="rounded-lg border bg-card px-4 py-3">
              <dt class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Hotel reference</dt>
              <dd class="mt-1 break-all font-mono text-sm text-foreground">{{ tenant.hotelRef }}</dd>
            </div>
            <div class="rounded-lg border bg-card px-4 py-3">
              <dt class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Time zone</dt>
              <dd class="mt-1 text-sm font-medium text-foreground">{{ tenant.timezone }}</dd>
              <dd v-if="currentClock" class="text-xs text-muted-foreground">{{ currentClock.offset }}</dd>
            </div>
            <div class="rounded-lg border bg-card px-4 py-3">
              <dt class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Local time now</dt>
              <dd class="mt-1 flex items-center gap-1.5 text-sm font-medium tabular-nums text-foreground">
                <ClockIcon class="size-4 text-primary" />
                <span aria-live="off">{{ currentClock?.time ?? '—' }}</span>
              </dd>
              <dd class="text-xs text-muted-foreground">
                <Badge :variant="tenant.isActive ? 'success' : 'secondary'">{{ tenant.isActive ? 'Active' : 'Inactive' }}</Badge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card class="rounded-xl">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold">Change the time zone</CardTitle>
          <CardDescription>
            An IANA name such as <span class="font-mono text-xs">Asia/Jakarta</span>. Operating schedules and every active template's
            next run move to the new zone; tasks that already exist keep their due dates.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-5">
          <Alert v-if="formError" variant="destructive">
            <AlertTitle>Could not save</AlertTitle>
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>
          <Alert v-if="savedNotice">
            <AlertTitle>Time zone saved</AlertTitle>
            <AlertDescription>{{ savedNotice }}</AlertDescription>
          </Alert>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Time zone</Label>
              <Select v-model="pick">
                <SelectTrigger class="w-full"><SelectValue placeholder="Pick a zone" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="zone in ZONES" :key="zone.value" :value="zone.value">{{ zone.label }}</SelectItem>
                  <SelectItem :value="OTHER">Other — type an IANA name</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div v-if="pick === OTHER" class="space-y-2">
              <Label for="tz-custom">IANA name</Label>
              <Input id="tz-custom" v-model="customZone" placeholder="e.g. Asia/Dubai" spellcheck="false" autocapitalize="none" />
            </div>
          </div>

          <p v-if="zoneInvalid" role="alert" class="text-xs font-medium text-destructive">
            This browser does not know “{{ chosenZone }}” as a time zone. Check the spelling against the IANA list — Region/City, case-sensitive.
          </p>
          <p v-else-if="chosenClock" class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClockIcon class="size-3.5" />
            It is <span class="font-semibold tabular-nums text-foreground">{{ chosenClock.time }}</span> in {{ chosenZone }} right now ({{ chosenClock.offset }}).
          </p>

          <div class="flex justify-end">
            <Button :disabled="!canSave" @click="requestSave">
              {{ isSaving ? 'Saving…' : 'Save time zone' }}
            </Button>
          </div>
        </CardContent>
      </Card>
    </template>

    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move {{ tenant?.name }} to {{ chosenZone }}?</AlertDialogTitle>
          <AlertDialogDescription class="space-y-2">
            <p>
              Operating schedules will be read in {{ chosenZone }} from now on, and every active template's next run moves to the new zone.
              Tasks that already exist keep their due dates.
            </p>
            <p v-if="tenant && chosenClock && currentClock">
              Right now that is {{ chosenClock.time }} ({{ chosenClock.offset }}) instead of {{ currentClock.time }} ({{ currentClock.offset }}).
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="save">Change time zone</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
