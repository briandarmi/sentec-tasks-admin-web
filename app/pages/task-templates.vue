<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArchiveIcon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, RepeatIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { TaskTemplateWrite } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { AssignableStaff, CatalogItem, Location, RecurrenceKind, TaskPriority, TaskTemplate, TaskTemplateRecurrence, Team } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES, formatDateTime, priorityMeta, taskRef } from '~/utils/task-ui'

/**
 * Task templates: task content plus an optional schedule. The API's worker
 * creates the scheduled tasks in the background; this screen only writes the
 * templates. Two scopes live side by side — SHARED ones an admin made here,
 * and PERSONAL ones staff made from the workspace's "Repeat" (an admin may
 * edit, pause and archive those too).
 *
 * The wire's TaskTemplate carries no scope field, so the two lists are
 * fetched separately (`scope=shared`, `scope=personal`) and tagged here
 * rather than read from one `scope=all` call that could not tell them apart.
 *
 * PUT is a full replace: Pause/Resume re-sends the row's own content with
 * `isActive` flipped. Saving a paused template skips the API's content
 * validation, so a resume can 422 where a pause never does.
 */
const api = useTasksApi()
const session = useSession()

type Scope = 'shared' | 'personal'
type TemplateRow = TaskTemplate & { scope: Scope }

const templates = ref<TemplateRow[]>([])
const items = ref<CatalogItem[]>([])
const locations = ref<Location[]>([])
const teams = ref<Team[]>([])
const staff = ref<AssignableStaff[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const actionError = ref('')
const formError = ref('')

const scopeFilter = ref<'all' | Scope>('all')
const activeOnly = ref(false)
/** Row ids with a pause/resume/archive in flight — per row, so one busy row never locks the table. */
const pendingIds = ref(new Set<string>())

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const visibleTemplates = computed(() =>
  templates.value
    .filter(t => scopeFilter.value === 'all' || t.scope === scopeFilter.value)
    .filter(t => !activeOnly.value || t.isActive),
)

const itemName = computed(() => new Map(items.value.map(i => [i.id, i.name])))
const locationName = computed(() => new Map(locations.value.map(l => [l.id, l.name])))
const teamName = computed(() => new Map(teams.value.map(t => [t.id, t.name])))
const staffName = computed(() => new Map(staff.value.map(s => [s.id, s.name])))

const pad = (n: number) => String(n).padStart(2, '0')
/** 0–1439 → "HH:MM". */
const minutesToClock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
/** "HH:MM" → 0–1439, or null when the field is not a clock time. */
function clockToMinutes(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null
}

/** One line the table can show: cadence, time and the optional date bounds. */
function scheduleSummary(recurrence: TaskTemplateRecurrence | null) {
  if (!recurrence) return 'No schedule — quick-pick only'
  const at = `at ${minutesToClock(recurrence.timeMinutes)}`
  let cadence: string
  switch (recurrence.kind) {
    case 'DAILY': cadence = `Daily ${at}`; break
    case 'WEEKLY': cadence = `Weekly on ${[...(recurrence.weekdays ?? [])].sort((a, b) => a - b).map(d => WEEKDAY_SHORT[d] ?? d).join(', ')} ${at}`; break
    case 'MONTHLY': cadence = `Monthly on day ${recurrence.dayOfMonth} ${at}`; break
    default: cadence = at
  }
  const bounds = [recurrence.startsOn ? `from ${recurrence.startsOn}` : '', recurrence.endsOn ? `until ${recurrence.endsOn}` : ''].filter(Boolean).join(' ')
  return bounds ? `${cadence}, ${bounds}` : cadence
}

function assigneeSummary(t: TemplateRow) {
  const a = t.content.assignee
  if (!a || a.assigneeKind === 'UNASSIGNED') return 'Unassigned'
  if (a.assigneeKind === 'TEAM') return `Team: ${teamName.value.get(a.assigneeTeamId ?? '') ?? '—'}`
  return staffName.value.get(a.assigneeStaffId ?? '') ?? 'A staff member'
}

/** The runs after the next one — `upcoming` leads with nextRunAt itself. */
function laterRuns(t: TemplateRow) {
  return t.upcoming.filter(iso => iso !== t.nextRunAt).slice(0, 3)
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [shared, personal] = await Promise.all([
      api.listTaskTemplates({ scope: 'shared' }),
      api.listTaskTemplates({ scope: 'personal' }),
    ])
    templates.value = [
      ...shared.map(t => ({ ...t, scope: 'shared' as const })),
      ...personal.map(t => ({ ...t, scope: 'personal' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
  // Lookups are for names and pickers; a failed one costs labels, not the screen.
  const [loadedItems, loadedLocations, loadedTeams, loadedStaff] = await Promise.all([
    api.listCatalogItems().catch(() => [] as CatalogItem[]),
    api.listLocations().catch(() => [] as Location[]),
    api.listTeams().catch(() => [] as Team[]),
    api.listAssignableStaff(null, {}).catch(() => [] as AssignableStaff[]),
  ])
  items.value = loadedItems
  locations.value = loadedLocations
  teams.value = loadedTeams
  staff.value = loadedStaff
}

// ── Create / edit ─────────────────────────────────────────────────────────────

const dialogOpen = ref(false)
const editRow = ref<TemplateRow | null>(null)
const formName = ref('')
const formActive = ref(true)
const formTitle = ref('')
const formDescription = ref('')
const formItemRef = ref('')
const formLocationRef = ref('')
const formRoomNumber = ref('')
const formPriority = ref<'' | TaskPriority>('')
/**
 * Held as text so a cleared field is distinguishable from a typed 0. The kit's
 * Input emits a number for type="number", so every read goes through String().
 */
const formQuantity = ref<string | number>('')
const formChecklist = ref('')
const formAssigneeKind = ref<'STAFF' | 'TEAM' | 'UNASSIGNED'>('UNASSIGNED')
const formAssigneeStaffId = ref('')
const formAssigneeTeamId = ref('')
const formRecurrenceKind = ref<'none' | RecurrenceKind>('none')
const formTime = ref('08:00')
const formWeekdays = ref<number[]>([])
const formDayOfMonth = ref<string | number>('1')
const formStartsOn = ref('')
const formEndsOn = ref('')

const dialogTitle = computed(() => (editRow.value ? `Edit “${editRow.value.name}”` : 'New template'))
const activeItems = computed(() => items.value.filter(i => i.isActive || i.id === formItemRef.value))
const activeLocations = computed(() => locations.value.filter(l => l.isActive || l.id === formLocationRef.value))
const activeTeams = computed(() => teams.value.filter(t => t.isActive || t.id === formAssigneeTeamId.value))

function quantityInvalid() {
  const text = String(formQuantity.value).trim()
  if (!text) return false
  const value = Number(text)
  return !Number.isInteger(value) || value < 1
}

/** The first thing wrong with the form, or '' when it can be sent. Shown under the footer. */
const formProblem = computed(() => {
  if (!formName.value.trim()) return 'A name is required.'
  if (!formTitle.value.trim()) return 'The task title is required.'
  if (quantityInvalid()) return 'Quantity must be a whole number of at least 1, or blank.'
  if (formAssigneeKind.value === 'STAFF' && !formAssigneeStaffId.value) return 'Pick the staff member to assign, or set the assignee to Unassigned.'
  if (formAssigneeKind.value === 'TEAM' && !formAssigneeTeamId.value) return 'Pick the team to assign, or set the assignee to Unassigned.'
  if (formRecurrenceKind.value !== 'none') {
    if (clockToMinutes(formTime.value) === null) return 'The run time must be a clock time (HH:MM).'
    if (formRecurrenceKind.value === 'WEEKLY' && formWeekdays.value.length === 0) return 'A weekly schedule needs at least one weekday.'
    if (formRecurrenceKind.value === 'MONTHLY') {
      const day = Number(formDayOfMonth.value)
      if (!Number.isInteger(day) || day < 1 || day > 28) return 'Day of month must be 1–28, so every month has it.'
    }
    if (formStartsOn.value && formEndsOn.value && formEndsOn.value < formStartsOn.value) return 'The end date cannot come before the start date.'
  }
  return ''
})
const canSave = computed(() => !isSaving.value && !formProblem.value)

function resetForm() {
  formName.value = ''
  formActive.value = true
  formTitle.value = ''
  formDescription.value = ''
  formItemRef.value = ''
  formLocationRef.value = ''
  formRoomNumber.value = ''
  formPriority.value = ''
  formQuantity.value = ''
  formChecklist.value = ''
  formAssigneeKind.value = 'UNASSIGNED'
  formAssigneeStaffId.value = ''
  formAssigneeTeamId.value = ''
  formRecurrenceKind.value = 'none'
  formTime.value = '08:00'
  formWeekdays.value = []
  formDayOfMonth.value = '1'
  formStartsOn.value = ''
  formEndsOn.value = ''
}

function openCreate() {
  editRow.value = null
  resetForm()
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(t: TemplateRow) {
  resetForm()
  editRow.value = t
  formName.value = t.name
  formActive.value = t.isActive
  formTitle.value = t.content.title
  formDescription.value = t.content.description ?? ''
  formItemRef.value = t.content.itemRef ?? ''
  formLocationRef.value = t.content.locationRef ?? ''
  formRoomNumber.value = t.content.roomNumber ?? ''
  formPriority.value = t.content.priority ?? ''
  formQuantity.value = t.content.quantity === null || t.content.quantity === undefined ? '' : String(t.content.quantity)
  formChecklist.value = t.content.checklistLabels.join('\n')
  formAssigneeKind.value = t.content.assignee?.assigneeKind ?? 'UNASSIGNED'
  formAssigneeStaffId.value = t.content.assignee?.assigneeStaffId ?? ''
  formAssigneeTeamId.value = t.content.assignee?.assigneeTeamId ?? ''
  if (t.recurrence) {
    formRecurrenceKind.value = t.recurrence.kind
    formTime.value = minutesToClock(t.recurrence.timeMinutes)
    formWeekdays.value = [...(t.recurrence.weekdays ?? [])]
    formDayOfMonth.value = String(t.recurrence.dayOfMonth ?? 1)
    formStartsOn.value = t.recurrence.startsOn ?? ''
    formEndsOn.value = t.recurrence.endsOn ?? ''
  }
  formError.value = ''
  dialogOpen.value = true
}

function toggleWeekday(day: number, checked: boolean) {
  const next = new Set(formWeekdays.value)
  if (checked) next.add(day)
  else next.delete(day)
  formWeekdays.value = [...next].sort((a, b) => a - b)
}

/** The whole template, every time — PUT replaces, it does not merge. */
function buildPayload(): TaskTemplateWrite {
  const kind = formRecurrenceKind.value
  const recurrence: TaskTemplateRecurrence | null = kind === 'none'
    ? null
    : {
        kind,
        timeMinutes: clockToMinutes(formTime.value) ?? 0,
        weekdays: kind === 'WEEKLY' ? formWeekdays.value : null,
        dayOfMonth: kind === 'MONTHLY' ? Number(formDayOfMonth.value) : null,
        startsOn: formStartsOn.value || null,
        endsOn: formEndsOn.value || null,
      }
  const assigneeKind = formAssigneeKind.value
  return {
    name: formName.value.trim(),
    isActive: formActive.value,
    content: {
      title: formTitle.value.trim(),
      description: formDescription.value.trim() || null,
      itemRef: formItemRef.value || null,
      locationRef: formLocationRef.value || null,
      roomNumber: formRoomNumber.value.trim() || null,
      priority: formPriority.value || null,
      quantity: String(formQuantity.value).trim() ? Number(formQuantity.value) : null,
      checklistLabels: formChecklist.value.split('\n').map(label => label.trim()).filter(Boolean),
      assignee: assigneeKind === 'STAFF'
        ? { assigneeKind, assigneeStaffId: formAssigneeStaffId.value }
        : assigneeKind === 'TEAM'
          ? { assigneeKind, assigneeTeamId: formAssigneeTeamId.value }
          : { assigneeKind: 'UNASSIGNED' },
    },
    recurrence,
  }
}

async function save() {
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  try {
    const payload = buildPayload()
    if (editRow.value) await api.updateTaskTemplate(editRow.value.id, payload)
    else await api.createTaskTemplate(payload)
    await load()
    dialogOpen.value = false
  }
  catch (e) {
    // 409 (duplicate name) and 422 (content does not resolve) come through verbatim.
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

// ── Pause / resume / archive ──────────────────────────────────────────────────

function markPending(id: string, on: boolean) {
  const next = new Set(pendingIds.value)
  if (on) next.add(id)
  else next.delete(id)
  pendingIds.value = next
}

async function togglePaused(t: TemplateRow) {
  if (pendingIds.value.has(t.id)) return
  markPending(t.id, true)
  actionError.value = ''
  try {
    await api.updateTaskTemplate(t.id, { name: t.name, isActive: !t.isActive, content: t.content, recurrence: t.recurrence })
    await load()
  }
  catch (e) {
    actionError.value = `Could not ${t.isActive ? 'pause' : 'resume'} “${t.name}”: ${(e as Error).message}`
  }
  finally {
    markPending(t.id, false)
  }
}

const archiveTarget = ref<TemplateRow | null>(null)

async function confirmArchive() {
  const t = archiveTarget.value
  if (!t || pendingIds.value.has(t.id)) return
  markPending(t.id, true)
  actionError.value = ''
  try {
    await api.archiveTaskTemplate(t.id)
    archiveTarget.value = null
    await load()
  }
  catch (e) {
    actionError.value = `Could not archive “${t.name}”: ${(e as Error).message}`
    archiveTarget.value = null
  }
  finally {
    markPending(t.id, false)
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Task Templates"
      :description="`Task content with an optional schedule. Scheduled runs are created by the API in ${session.activeHotel.value?.name ?? 'the property'}'s own time zone.`"
      :icon="RepeatIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New template
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

    <Alert v-if="actionError" variant="destructive">
      <AlertTitle>Could not update the template</AlertTitle>
      <AlertDescription>{{ actionError }}</AlertDescription>
    </Alert>

    <Card class="rounded-xl">
      <CardContent>
        <div class="flex items-start gap-3">
          <RepeatIcon class="mt-0.5 shrink-0 text-primary" />
          <p class="text-sm text-foreground">
            <span class="font-semibold">Shared</span> templates are made here and offered to everyone at the property;
            <span class="font-semibold">personal</span> ones are a staff member's own repeating tasks, made from the workspace.
            An admin may edit, pause or archive either. A paused template makes no tasks; if its owner loses access or the
            create-task permission, the API pauses it and says why.
          </p>
        </div>
      </CardContent>
    </Card>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <Tabs v-model="scopeFilter">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="shared">Shared</TabsTrigger>
          <TabsTrigger value="personal">Personal</TabsTrigger>
        </TabsList>
      </Tabs>
      <div class="flex items-center gap-2">
        <Switch id="templates-active-only" v-model="activeOnly" />
        <Label for="templates-active-only" class="cursor-pointer">Active only</Label>
      </div>
    </div>

    <TableSkeleton v-if="isLoading && templates.length === 0" :rows="4" :columns="6" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="t in visibleTemplates" :key="t.id" :class="t.isActive ? '' : 'opacity-70'">
                <TableCell class="align-top">
                  <p class="font-medium text-foreground">{{ t.name }}</p>
                  <p class="max-w-72 truncate text-xs text-muted-foreground">{{ t.content.title }}</p>
                  <p class="text-xs text-muted-foreground">{{ assigneeSummary(t) }}<template v-if="t.content.checklistLabels.length"> · {{ t.content.checklistLabels.length }} steps</template></p>
                </TableCell>
                <TableCell class="align-top">
                  <Badge :variant="t.scope === 'personal' ? 'warning' : 'default'">{{ t.scope === 'personal' ? 'Personal' : 'Shared' }}</Badge>
                  <p class="mt-1 text-xs text-muted-foreground">{{ t.ownerName ?? '—' }}</p>
                </TableCell>
                <TableCell class="max-w-56 align-top text-sm text-foreground">{{ scheduleSummary(t.recurrence) }}</TableCell>
                <TableCell class="align-top">
                  <p class="text-sm text-foreground">{{ t.isActive && t.recurrence ? formatDateTime(t.nextRunAt) : '—' }}</p>
                  <p v-if="t.isActive && laterRuns(t).length" class="text-xs text-muted-foreground">
                    then {{ laterRuns(t).map(iso => formatDateTime(iso)).join(' · ') }}
                  </p>
                </TableCell>
                <TableCell class="align-top">
                  <p class="text-sm text-foreground">{{ formatDateTime(t.lastRunAt) }}</p>
                  <!-- Text only: this console has no task detail screen to link to. -->
                  <p v-if="t.lastTaskId" class="font-mono text-xs text-muted-foreground">{{ taskRef(t.lastTaskId) }}</p>
                </TableCell>
                <TableCell class="align-top">
                  <Badge :variant="t.isActive ? 'success' : 'secondary'">{{ t.isActive ? 'Active' : 'Paused' }}</Badge>
                  <p v-if="t.lastError" role="alert" class="mt-1 max-w-56 text-xs font-medium text-destructive">{{ t.lastError }}</p>
                </TableCell>
                <TableCell class="align-top text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      :disabled="pendingIds.has(t.id)"
                      :aria-busy="pendingIds.has(t.id)"
                      :aria-label="`${t.isActive ? 'Pause' : 'Resume'} ${t.name}`"
                      @click="togglePaused(t)"
                    >
                      <component :is="t.isActive ? PauseIcon : PlayIcon" />
                      {{ t.isActive ? 'Pause' : 'Resume' }}
                    </Button>
                    <Button size="sm" variant="outline" :aria-label="`Edit ${t.name}`" @click="openEdit(t)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      :disabled="pendingIds.has(t.id)"
                      :aria-label="`Archive ${t.name}`"
                      @click="archiveTarget = t"
                    >
                      <ArchiveIcon />
                      Archive
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && visibleTemplates.length === 0">
                <TableCell colspan="7" class="py-10 text-center text-sm text-muted-foreground">
                  {{ templates.length === 0 ? 'No templates yet.' : 'Nothing matches this filter.' }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>
            Saving replaces the whole template. An active template's content is checked the way a new task is; a paused one is saved as-is.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-6 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <div class="space-y-2">
              <Label for="tpl-name">Template name</Label>
              <Input id="tpl-name" v-model="formName" maxlength="120" placeholder="e.g. Nightly minibar count" />
              <p class="text-xs text-muted-foreground">Unique at the property, case-insensitive.</p>
            </div>
            <div class="flex items-center gap-3 rounded-lg border px-4 py-3 sm:self-start">
              <Label for="tpl-active" class="cursor-pointer">Active</Label>
              <Switch id="tpl-active" v-model="formActive" />
            </div>
          </div>

          <div class="space-y-4">
            <p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">Task content</p>
            <div class="space-y-2">
              <Label for="tpl-title">Title</Label>
              <Input id="tpl-title" v-model="formTitle" maxlength="255" placeholder="What each task will be called" />
            </div>
            <div class="space-y-2">
              <Label for="tpl-desc">Description</Label>
              <Textarea id="tpl-desc" v-model="formDescription" rows="2" placeholder="What staff should know (optional)" />
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label>Catalog item</Label>
                <Select :model-value="toSelectValue(formItemRef)" @update:model-value="value => formItemRef = fromSelectValue(value)">
                  <SelectTrigger class="w-full"><SelectValue placeholder="No item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="SELECT_EMPTY">No item</SelectItem>
                    <SelectItem v-for="item in activeItems" :key="item.id" :value="item.id">{{ item.name }}<template v-if="!item.isActive"> (deactivated)</template></SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-2">
                <Label>Location</Label>
                <Select :model-value="toSelectValue(formLocationRef)" @update:model-value="value => formLocationRef = fromSelectValue(value)">
                  <SelectTrigger class="w-full"><SelectValue placeholder="No location" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="SELECT_EMPTY">No location</SelectItem>
                    <SelectItem v-for="location in activeLocations" :key="location.id" :value="location.id">{{ location.name }}<template v-if="!location.isActive"> (deactivated)</template></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div class="space-y-2">
                <Label for="tpl-room">Room / area</Label>
                <Input id="tpl-room" v-model="formRoomNumber" placeholder="e.g. 1204 or Floor 12" />
              </div>
              <div class="space-y-2">
                <Label>Priority</Label>
                <Select :model-value="toSelectValue(formPriority)" @update:model-value="value => formPriority = fromSelectValue(value) as '' | TaskPriority">
                  <SelectTrigger class="w-full"><SelectValue placeholder="Item default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem :value="SELECT_EMPTY">Item default</SelectItem>
                    <SelectItem v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">{{ priorityMeta(priority).label }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-2">
                <Label for="tpl-qty">Quantity</Label>
                <Input id="tpl-qty" v-model="formQuantity" type="number" min="1" step="1" placeholder="—" />
              </div>
            </div>
            <div class="space-y-2">
              <Label for="tpl-checklist">Checklist steps</Label>
              <Textarea id="tpl-checklist" v-model="formChecklist" rows="3" placeholder="One step per line (optional)" />
            </div>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label>Assign to</Label>
                <Select v-model="formAssigneeKind">
                  <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGNED">Unassigned — routing decides</SelectItem>
                    <SelectItem value="STAFF">A staff member</SelectItem>
                    <SelectItem value="TEAM">A team</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="formAssigneeKind === 'STAFF'" class="space-y-2">
                <Label>Staff member</Label>
                <Select v-model="formAssigneeStaffId">
                  <SelectTrigger class="w-full"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="person in staff" :key="person.id" :value="person.id">{{ person.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-else-if="formAssigneeKind === 'TEAM'" class="space-y-2">
                <Label>Team</Label>
                <Select v-model="formAssigneeTeamId">
                  <SelectTrigger class="w-full"><SelectValue placeholder="Pick a team" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="team in activeTeams" :key="team.id" :value="team.id">{{ team.name }}<template v-if="!team.isActive"> (inactive)</template></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <p class="text-xs font-bold uppercase tracking-widest text-muted-foreground">Schedule</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label>Repeats</Label>
                <Select v-model="formRecurrenceKind">
                  <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Never — quick-pick only</SelectItem>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="formRecurrenceKind !== 'none'" class="space-y-2">
                <Label for="tpl-time">At (hotel local time)</Label>
                <Input id="tpl-time" v-model="formTime" type="time" step="60" />
              </div>
            </div>

            <div v-if="formRecurrenceKind === 'WEEKLY'" class="space-y-2">
              <Label>On</Label>
              <div class="flex flex-wrap gap-x-5 gap-y-2">
                <label v-for="(day, index) in WEEKDAY_SHORT" :key="day" class="flex items-center gap-2 text-sm">
                  <Checkbox :model-value="formWeekdays.includes(index)" :aria-label="day" @update:model-value="checked => toggleWeekday(index, checked === true)" />
                  {{ day }}
                </label>
              </div>
            </div>

            <div v-if="formRecurrenceKind === 'MONTHLY'" class="space-y-2 sm:max-w-48">
              <Label for="tpl-dom">Day of month</Label>
              <Input id="tpl-dom" v-model="formDayOfMonth" type="number" min="1" max="28" step="1" />
              <p class="text-xs text-muted-foreground">1–28, so every month has it.</p>
            </div>

            <div v-if="formRecurrenceKind !== 'none'" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label for="tpl-starts">Starts on</Label>
                <Input id="tpl-starts" v-model="formStartsOn" type="date" />
              </div>
              <div class="space-y-2">
                <Label for="tpl-ends">Ends on</Label>
                <Input id="tpl-ends" v-model="formEndsOn" type="date" />
              </div>
              <p class="text-xs text-muted-foreground sm:col-span-2">Both optional, as dates in the hotel's zone.</p>
            </div>
          </div>
        </div>

        <DialogFooter class="sm:items-center">
          <p v-if="formProblem" class="mr-auto text-xs font-medium text-muted-foreground">{{ formProblem }}</p>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(archiveTarget)" @update:open="value => { if (!value) archiveTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive “{{ archiveTarget?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops making tasks and leaves every list. Tasks already made stay exactly as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="Boolean(archiveTarget && pendingIds.has(archiveTarget.id))">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="Boolean(archiveTarget && pendingIds.has(archiveTarget.id))"
            @click.prevent="confirmArchive"
          >
            {{ archiveTarget && pendingIds.has(archiveTarget.id) ? 'Archiving…' : 'Archive' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
