<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CalendarClockIcon, ClockIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { HotelDepartment, OperatingException, OperatingSchedule, OperatingWindow } from '~/utils/clientFakeApi'

const api = useTasksApi()

const schedules = ref<OperatingSchedule[]>([])
const departments = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

const departmentName = computed(() => new Map(departments.value.map(d => [d.id, d.departmentName])))

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Two separate "—" constants on purpose: the Default column's negative state
 * and the Department column's empty state are different facts, so rewording
 * one must never silently reword the other.
 */
const NOT_DEFAULT_LABEL = '—'
const NO_DEPARTMENT_LABEL = 'Property-wide'

// ── minute ⇄ time-string conversion ──────────────────────────────────────────

function toMinutes(time: string) {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * `<input type="time">` has no representation for midnight-as-end-of-day
 * (24:00 is invalid), so 1440 displays as 23:59 — and the "until midnight"
 * checkbox below is what keeps a save from eroding it to 23:59 for real.
 */
function fromMinutes(total: number) {
  const clamped = Math.min(total, 1439)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ── details dialog (name / default / department) ─────────────────────────────

const detailsOpen = ref(false)
const detailsSaving = ref(false)
const detailsError = ref('')
const editId = ref<string | undefined>()
const formName = ref('')
const formDefault = ref(false)
const formDepartmentId = ref('')

const detailsTitle = computed(() => (editId.value ? 'Edit schedule' : 'New schedule'))
const canSaveDetails = computed(() => !detailsSaving.value && Boolean(formName.value.trim()))

// ── hours dialog (windows / exceptions) ──────────────────────────────────────

/**
 * Three-way mode, not a boolean: a weekday with no stored window is CLOSED,
 * and only OPEN_24H / CUSTOM weekdays are ever written back. Sending all seven
 * days unconditionally is exactly the bug that once turned closed weekdays
 * into open-24/7 rows on every save.
 */
type WindowMode = 'CLOSED' | 'OPEN_24H' | 'CUSTOM'
interface WindowDraft {
  mode: WindowMode
  opensTime: string
  closesTime: string
  closesAtMidnight: boolean
}
interface ExceptionDraft {
  date: string
  isClosed: boolean
  opensTime: string
  closesTime: string
}

const hoursOpen = ref(false)
const hoursSaving = ref(false)
const hoursError = ref('')
const hoursSchedule = ref<OperatingSchedule | null>(null)
const windowDrafts = ref<WindowDraft[]>([])
const exceptionDrafts = ref<ExceptionDraft[]>([])

function defaultWindowDraft(): WindowDraft {
  // The times are only a starting point for switching to CUSTOM; a CLOSED
  // weekday's times are never sent.
  return { mode: 'CLOSED', opensTime: '09:00', closesTime: '17:00', closesAtMidnight: false }
}

function buildWindowDrafts(schedule: OperatingSchedule): WindowDraft[] {
  return WEEKDAY_LABELS.map((_, weekday) => {
    const window = schedule.windows.find(w => w.weekday === weekday)
    if (!window) return defaultWindowDraft()
    if (window.opensMinutes === 0 && window.closesMinutes === 1440) {
      return { mode: 'OPEN_24H', opensTime: '00:00', closesTime: '23:59', closesAtMidnight: false }
    }
    return {
      mode: 'CUSTOM',
      opensTime: fromMinutes(window.opensMinutes),
      closesTime: fromMinutes(window.closesMinutes),
      closesAtMidnight: window.closesMinutes === 1440,
    }
  })
}

function buildExceptionDrafts(schedule: OperatingSchedule): ExceptionDraft[] {
  return schedule.exceptions.map(exception => ({
    date: exception.date,
    isClosed: exception.isClosed,
    opensTime: fromMinutes(exception.opensMinutes ?? 540),
    closesTime: fromMinutes(exception.closesMinutes ?? 1020),
  }))
}

function setWindowMode(draft: WindowDraft, mode: WindowMode) {
  if (mode === draft.mode) return
  if (mode === 'OPEN_24H') {
    draft.opensTime = '00:00'
    draft.closesTime = '23:59'
    draft.closesAtMidnight = false
  }
  else if (mode === 'CUSTOM') {
    // Entering CUSTOM from another mode starts from a sane span rather than
    // whatever 24h snapping left behind.
    draft.opensTime = '09:00'
    draft.closesTime = '17:00'
    draft.closesAtMidnight = false
  }
  draft.mode = mode
}

function setClosesAtMidnight(draft: WindowDraft, checked: boolean) {
  draft.closesAtMidnight = checked
  // Checked: show the closest displayable time to midnight. Unchecked: the
  // input becomes editable again, so don't leave it on a meaningless 23:59.
  draft.closesTime = checked ? fromMinutes(1440) : '17:00'
}

function addException() {
  exceptionDrafts.value.push({ date: '', isClosed: true, opensTime: '09:00', closesTime: '17:00' })
}

function removeException(index: number) {
  exceptionDrafts.value.splice(index, 1)
}

/** Human summary for the table: how many weekdays are open, plus exceptions. */
function hoursSummary(schedule: OperatingSchedule) {
  const openDays = new Set(schedule.windows.map(w => w.weekday)).size
  const always = schedule.windows.length === 7 && schedule.windows.every(w => w.opensMinutes === 0 && w.closesMinutes === 1440)
  const days = always ? 'Open 24/7' : openDays === 0 ? 'Closed all week' : `Open ${openDays} day${openDays === 1 ? '' : 's'}/week`
  const exceptions = schedule.exceptions.length
  return exceptions ? `${days} · ${exceptions} exception${exceptions === 1 ? '' : 's'}` : days
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedSchedules, loadedDepartments] = await Promise.all([
      api.listOperatingSchedules(),
      api.listHotelDepartments(),
    ])
    schedules.value = loadedSchedules
    departments.value = loadedDepartments
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreate() {
  editId.value = undefined
  formName.value = ''
  formDefault.value = false
  formDepartmentId.value = ''
  detailsError.value = ''
  detailsOpen.value = true
}

function openEdit(schedule: OperatingSchedule) {
  editId.value = schedule.id
  formName.value = schedule.name
  formDefault.value = schedule.isDefault
  formDepartmentId.value = schedule.hotelDepartmentId ?? ''
  detailsError.value = ''
  detailsOpen.value = true
}

async function saveDetails() {
  if (detailsSaving.value) return
  detailsSaving.value = true
  detailsError.value = ''
  try {
    // Every save replaces the FULL windows/exceptions set, so a rename must
    // echo the stored hours back — baselined from the loaded row, or empty
    // for a schedule that does not exist yet.
    const existing = editId.value ? schedules.value.find(s => s.id === editId.value) : undefined
    await api.upsertOperatingSchedule({
      id: editId.value,
      name: formName.value,
      isDefault: formDefault.value,
      hotelDepartmentId: formDepartmentId.value || null,
      windows: existing?.windows ?? [],
      exceptions: existing?.exceptions ?? [],
    })
    await load()
    detailsOpen.value = false
  }
  catch (e) {
    detailsError.value = (e as Error).message
  }
  finally {
    detailsSaving.value = false
  }
}

function openHours(schedule: OperatingSchedule) {
  hoursSchedule.value = schedule
  windowDrafts.value = buildWindowDrafts(schedule)
  exceptionDrafts.value = buildExceptionDrafts(schedule)
  hoursError.value = ''
  hoursOpen.value = true
}

async function saveHours() {
  const schedule = hoursSchedule.value
  if (!schedule || hoursSaving.value) return
  hoursSaving.value = true
  hoursError.value = ''
  try {
    // CLOSED weekdays are omitted entirely — absence IS the closed flag.
    const windows: OperatingWindow[] = []
    windowDrafts.value.forEach((draft, weekday) => {
      if (draft.mode === 'CLOSED') return
      if (draft.mode === 'OPEN_24H') {
        windows.push({ weekday, opensMinutes: 0, closesMinutes: 1440 })
        return
      }
      windows.push({
        weekday,
        opensMinutes: toMinutes(draft.opensTime),
        // "Until midnight" sends 1440 regardless of the displayed 23:59, so a
        // midnight close never erodes by a minute per save.
        closesMinutes: draft.closesAtMidnight ? 1440 : toMinutes(draft.closesTime),
      })
    })

    // Blank dates are dropped: an exception without a date is not an exception.
    const exceptions: OperatingException[] = exceptionDrafts.value
      .filter(draft => draft.date.trim())
      .map(draft => draft.isClosed
        ? { date: draft.date, isClosed: true, opensMinutes: null, closesMinutes: null }
        : { date: draft.date, isClosed: false, opensMinutes: toMinutes(draft.opensTime), closesMinutes: toMinutes(draft.closesTime) },
      )

    // Name/default/department ride along unchanged — the upsert is a full
    // replace, so leaving them out would wipe them.
    await api.upsertOperatingSchedule({
      id: schedule.id,
      name: schedule.name,
      isDefault: schedule.isDefault,
      hotelDepartmentId: schedule.hotelDepartmentId,
      windows,
      exceptions,
    })
    await load()
    hoursOpen.value = false
  }
  catch (e) {
    hoursError.value = (e as Error).message
  }
  finally {
    hoursSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Operating schedules"
      description="When the property — or one department — is open to take work. A weekday with no hours is closed."
      :icon="CalendarClockIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New schedule
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && schedules.length === 0" :rows="3" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="schedule in schedules" :key="schedule.id">
                <TableCell class="font-medium text-foreground">{{ schedule.name }}</TableCell>
                <TableCell>
                  <Badge v-if="schedule.isDefault" variant="success">Default</Badge>
                  <span v-else class="text-muted-foreground">{{ NOT_DEFAULT_LABEL }}</span>
                </TableCell>
                <TableCell class="text-foreground">
                  {{ schedule.hotelDepartmentId ? departmentName.get(schedule.hotelDepartmentId) ?? '—' : NO_DEPARTMENT_LABEL }}
                </TableCell>
                <TableCell class="text-muted-foreground">{{ hoursSummary(schedule) }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" :aria-label="`Weekly hours for ${schedule.name}`" @click="openHours(schedule)">
                      <ClockIcon />
                      Hours
                    </Button>
                    <Button size="sm" variant="outline" :aria-label="`Edit ${schedule.name}`" @click="openEdit(schedule)">
                      <PencilIcon />
                      Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && schedules.length === 0">
                <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                  No schedules yet. Without one, the property is treated as always open.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="detailsOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ detailsTitle }}</DialogTitle>
          <DialogDescription>One default per property, and at most one schedule per department.</DialogDescription>
        </DialogHeader>

        <Alert v-if="detailsError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ detailsError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="sched-name">Name</Label>
            <Input id="sched-name" v-model="formName" placeholder="e.g. Engineering Hours" maxlength="100" />
          </div>

          <div class="space-y-2">
            <Label>Department</Label>
            <Select :model-value="toSelectValue(formDepartmentId)" @update:model-value="value => formDepartmentId = fromSelectValue(value)">
              <SelectTrigger class="w-full">
                <SelectValue :placeholder="NO_DEPARTMENT_LABEL" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="SELECT_EMPTY">{{ NO_DEPARTMENT_LABEL }}</SelectItem>
                <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.departmentName }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="sched-default" class="cursor-pointer">Default schedule</Label>
              <!-- Unlike SLAs, a second default is refused rather than swapped:
                   the server names the schedule in the way. -->
              <p class="text-xs text-muted-foreground">Used when nothing more specific applies. Only one per property.</p>
            </div>
            <Switch id="sched-default" v-model="formDefault" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="detailsSaving" @click="detailsOpen = false">Cancel</Button>
          <Button :disabled="!canSaveDetails" @click="saveDetails">
            {{ detailsSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="hoursOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Weekly hours for {{ hoursSchedule?.name }}</DialogTitle>
          <DialogDescription>A weekday set to Closed is simply not saved — absence is the closed flag.</DialogDescription>
        </DialogHeader>

        <Alert v-if="hoursError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ hoursError }}</AlertDescription>
        </Alert>

        <div class="space-y-2 py-2">
          <div
            v-for="(draft, weekday) in windowDrafts"
            :key="weekday"
            class="grid grid-cols-1 items-center gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[7rem_10rem_1fr]"
          >
            <span class="text-sm font-medium text-foreground">{{ WEEKDAY_LABELS[weekday] }}</span>
            <Select :model-value="draft.mode" @update:model-value="value => setWindowMode(draft, value as typeof draft.mode)">
              <SelectTrigger class="w-full" :aria-label="`${WEEKDAY_LABELS[weekday]} mode for ${hoursSchedule?.name}`">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CLOSED">Closed</SelectItem>
                <SelectItem value="OPEN_24H">Open 24 hours</SelectItem>
                <SelectItem value="CUSTOM">Custom hours</SelectItem>
              </SelectContent>
            </Select>
            <div v-if="draft.mode === 'CUSTOM'" class="flex flex-wrap items-center gap-2">
              <Input
                v-model="draft.opensTime"
                type="time"
                class="w-28"
                :aria-label="`${WEEKDAY_LABELS[weekday]} opens`"
              />
              <span class="text-xs text-muted-foreground">to</span>
              <Input
                v-model="draft.closesTime"
                type="time"
                class="w-28"
                :disabled="draft.closesAtMidnight"
                :aria-label="`${WEEKDAY_LABELS[weekday]} closes`"
              />
              <label class="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  :model-value="draft.closesAtMidnight"
                  :aria-label="`${WEEKDAY_LABELS[weekday]} closes at midnight`"
                  @update:model-value="checked => setClosesAtMidnight(draft, checked === true)"
                />
                Until midnight
              </label>
            </div>
            <span v-else class="text-xs text-muted-foreground">
              {{ draft.mode === 'OPEN_24H' ? 'All day' : 'No hours saved for this day' }}
            </span>
          </div>

          <div class="space-y-2 pt-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-foreground">Exceptions</p>
                <p class="text-xs text-muted-foreground">Dated overrides — a public holiday closure, a one-off late opening.</p>
              </div>
              <Button size="sm" variant="outline" type="button" @click="addException">
                <PlusIcon />
                Add exception
              </Button>
            </div>

            <p v-if="exceptionDrafts.length === 0" class="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
              No exceptions yet.
            </p>
            <div
              v-for="(exception, index) in exceptionDrafts"
              v-else
              :key="index"
              class="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
            >
              <Input
                v-model="exception.date"
                type="date"
                class="w-40"
                :aria-label="`Exception ${index + 1} date`"
              />
              <Select :model-value="exception.isClosed ? 'closed' : 'open'" @update:model-value="value => exception.isClosed = value === 'closed'">
                <SelectTrigger class="w-36" :aria-label="`Exception ${index + 1} mode`">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="open">Open with hours</SelectItem>
                </SelectContent>
              </Select>
              <template v-if="!exception.isClosed">
                <Input v-model="exception.opensTime" type="time" class="w-28" :aria-label="`Exception ${index + 1} opens`" />
                <span class="text-xs text-muted-foreground">to</span>
                <Input v-model="exception.closesTime" type="time" class="w-28" :aria-label="`Exception ${index + 1} closes`" />
              </template>
              <Button
                size="icon"
                variant="ghost"
                type="button"
                class="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                :aria-label="`Remove exception ${index + 1} from ${hoursSchedule?.name}`"
                @click="removeException(index)"
              >
                <Trash2Icon class="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="hoursSaving" @click="hoursOpen = false">Cancel</Button>
          <Button :disabled="hoursSaving" @click="saveHours">
            {{ hoursSaving ? 'Saving…' : 'Save hours' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
