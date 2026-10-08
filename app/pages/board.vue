<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, SquareKanbanIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi, type BoardColumnEdit } from '~/composables/useTasksApi'
import type { Board, BoardColumn, TaskListItem, TaskStatus } from '~/utils/clientFakeApi'
import { TASK_STATUSES } from '~/utils/clientFakeApi'
import { priorityMeta, statusMeta } from '~/utils/task-ui'

/**
 * Board columns ride ONE endpoint in the real API: PATCH /v1/kanban-board
 * takes a list of column edits (create, change, soft-remove) and answers with
 * the fresh board plus meta.warnings — a removal that would orphan active work
 * is SKIPPED and reported there, never an error. A column's status link is
 * immutable once created.
 *
 * The kanban below is view + move. Field editing is deliberately absent:
 * PATCH /v1/tasks/update admits leaders-of-the-department and services only —
 * a tenant admin human is refused — so offering an edit form here would be a
 * button that always 403s for this console's own persona.
 */
const api = useTasksApi()

const board = ref<(Board & { columns: BoardColumn[] }) | null>(null)
const tasks = ref<TaskListItem[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')
/** meta.warnings from the last PATCH — skipped removals, a missing NEW column. */
const boardWarnings = ref<string[]>([])

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formDescription = ref('')
const formStatus = ref<TaskStatus>('IN_PROGRESS')
const formSort = ref(1)

const columns = computed(() => board.value?.columns ?? [])
const dialogTitle = computed(() => (editId.value ? 'Edit column' : 'New column'))

/** Whole number, 1 or more — the API refuses anything else. */
const sortInvalid = computed(() => !Number.isInteger(Number(formSort.value)) || Number(formSort.value) < 1)
const canSave = computed(() => !isSaving.value && Boolean(formName.value.trim()) && !sortInvalid.value)

// ── column removal ────────────────────────────────────────────────────────────

const removeDialogOpen = ref(false)
const isRemoving = ref(false)
const removeTarget = ref<{ id: string, name: string } | null>(null)

function requestRemove(column: BoardColumn) {
  removeTarget.value = { id: column.id, name: column.name }
  removeDialogOpen.value = true
}

async function applyEdits(edits: BoardColumnEdit[]) {
  const result = await api.editKanbanBoard(edits)
  board.value = result.board
  boardWarnings.value = result.warnings
}

async function performRemove() {
  const target = removeTarget.value
  if (!target || isRemoving.value) return
  isRemoving.value = true
  errorMessage.value = ''
  try {
    await applyEdits([{ id: target.id, isRemoved: true }])
    await loadTasks()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isRemoving.value = false
    removeDialogOpen.value = false
    removeTarget.value = null
  }
}

async function loadTasks() {
  const res = await api.listTasks({ limit: 100 })
  tasks.value = res.data
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    board.value = await api.getKanbanBoard()
    await loadTasks()
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
  formDescription.value = ''
  formStatus.value = 'IN_PROGRESS'
  formSort.value = columns.value.length + 1
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(column: BoardColumn) {
  editId.value = column.id
  formName.value = column.name
  formDescription.value = column.description ?? ''
  formStatus.value = column.status ?? 'IN_PROGRESS'
  formSort.value = column.columnSort
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  try {
    // Status rides only on CREATE — it is immutable on an existing column.
    const entry: BoardColumnEdit = editId.value
      ? { id: editId.value, name: formName.value.trim(), description: formDescription.value.trim() || null, columnSort: Number(formSort.value) }
      : { name: formName.value.trim(), description: formDescription.value.trim() || null, columnSort: Number(formSort.value), status: formStatus.value }
    await applyEdits([entry])
    dialogOpen.value = false
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

// ── the kanban: view + column moves ───────────────────────────────────────────

const tasksByColumn = computed(() => {
  const grouped = new Map<string, TaskListItem[]>()
  for (const task of tasks.value) {
    if (!task.columnId) continue
    grouped.set(task.columnId, [...(grouped.get(task.columnId) ?? []), task])
  }
  return grouped
})

const moveDialogOpen = ref(false)
const isMoving = ref(false)
const moveError = ref('')
const moveTask = ref<TaskListItem | null>(null)
const moveColumnId = ref('')

/**
 * Only offer moves the lifecycle allows: never into New or Awaiting Review;
 * a SUBMITTED task may only be parked or cancelled (review decides it).
 */
function moveTargets(task: TaskListItem) {
  return columns.value.filter((column) => {
    if (!column.status || column.id === task.columnId) return false
    if (column.status === 'NEW' || column.status === 'SUBMITTED') return false
    if (task.status === 'SUBMITTED' && !['PENDING', 'CANCELLED'].includes(column.status)) return false
    return true
  })
}

function openMove(task: TaskListItem) {
  moveTask.value = task
  moveColumnId.value = ''
  moveError.value = ''
  moveDialogOpen.value = true
}

async function performMove() {
  const task = moveTask.value
  if (!task || !moveColumnId.value || isMoving.value) return
  isMoving.value = true
  moveError.value = ''
  try {
    await api.moveTask({ taskId: task.id, columnId: moveColumnId.value })
    await loadTasks()
    moveDialogOpen.value = false
  }
  catch (e) {
    moveError.value = (e as Error).message
  }
  finally {
    isMoving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Board columns"
      description="The workflow staff see. Moving a task to a column sets its status."
      :icon="SquareKanbanIcon"
    >
      <template #actions>
        <Button size="sm" :disabled="!board" @click="openCreate">
          <PlusIcon />
          New column
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <!-- The server's own warnings: skipped removals, a board with no NEW column. -->
    <Alert v-for="warning in boardWarnings" :key="warning">
      <AlertTitle>The board says</AlertTitle>
      <AlertDescription>{{ warning }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && !board" :rows="5" :columns="4" />

    <template v-else-if="board">
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-16">Order</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Sets status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="column in columns" :key="column.id">
                <TableCell class="font-semibold tabular-nums text-muted-foreground">{{ column.columnSort }}</TableCell>
                <TableCell>
                  <p class="font-medium text-foreground">{{ column.name }}</p>
                  <p v-if="column.description" class="text-xs text-muted-foreground">{{ column.description }}</p>
                </TableCell>
                <TableCell>
                  <span v-if="column.status" class="inline-flex items-center gap-2 text-sm text-foreground">
                    <span class="h-2 w-2 rounded-full" :class="statusMeta(column.status).dot" />
                    {{ statusMeta(column.status).label }}
                  </span>
                  <span v-else class="text-sm text-muted-foreground">No status</span>
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="secondary" :aria-label="`Edit ${column.name}`" @click="openEdit(column)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      class="text-muted-foreground hover:text-destructive"
                      :aria-label="`Remove ${column.name}`"
                      @click="requestRemove(column)"
                    >
                      <Trash2Icon />
                      Remove
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- The board itself, in the staff-facing order. Click a task to move it. -->
      <Card class="rounded-xl">
        <CardHeader>
          <CardTitle class="text-base font-semibold">The board</CardTitle>
          <CardDescription>{{ board.name }} — click a task to move it between columns.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="overflow-x-auto pb-2">
            <div class="flex gap-3" style="min-width: max-content">
              <div
                v-for="column in columns"
                :key="column.id"
                class="w-60 shrink-0 rounded-xl border bg-muted/30 p-2"
              >
                <p class="flex items-center gap-2 px-1 pb-2 text-xs font-semibold text-foreground">
                  <span class="h-2 w-2 rounded-full" :class="column.status ? statusMeta(column.status).dot : 'bg-muted-foreground/40'" />
                  {{ column.name }}
                  <span class="ml-auto tabular-nums text-muted-foreground">{{ (tasksByColumn.get(column.id) ?? []).length }}</span>
                </p>
                <div class="space-y-2">
                  <button
                    v-for="task in tasksByColumn.get(column.id) ?? []"
                    :key="task.id"
                    type="button"
                    class="w-full rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    @click="openMove(task)"
                  >
                    <p class="text-xs font-semibold leading-snug text-foreground">{{ task.title }}</p>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="task.priority !== 'NORMAL'"
                        class="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        :class="priorityMeta(task.priority).badge"
                      >{{ priorityMeta(task.priority).label }}</span>
                      <span v-if="task.roomNumber" class="text-[10px] text-muted-foreground">{{ task.roomNumber }}</span>
                      <span v-if="task.sourceProduct !== 'sentec-tasks'" class="text-[10px] text-muted-foreground">· {{ task.sourceProduct }}</span>
                    </div>
                  </button>
                  <p v-if="!(tasksByColumn.get(column.id) ?? []).length" class="px-1 py-3 text-center text-[11px] text-muted-foreground/70">
                    Empty
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </template>

    <EmptyState
      v-else-if="!isLoading"
      :icon="SquareKanbanIcon"
      title="No board for this property"
      description="Boards are provisioned during onboarding. Ask an operator to provision this tenant."
    />

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Columns are what staff move work between.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="col-name">Name</Label>
            <Input id="col-name" v-model="formName" placeholder="e.g. Awaiting parts" />
          </div>

          <div class="space-y-2">
            <Label for="col-desc">Description</Label>
            <Input id="col-desc" v-model="formDescription" placeholder="Shown under the column name (optional)" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Sets status</Label>
              <Select v-model="formStatus" :disabled="Boolean(editId)">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="status in TASK_STATUSES" :key="status" :value="status">
                    {{ statusMeta(status).label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">
                {{ editId ? 'Immutable once a column exists — the API refuses a change.' : 'Moving a task here sets this status and drives the SLA clocks.' }}
              </p>
            </div>
            <div class="space-y-2">
              <Label for="col-sort">Order</Label>
              <Input id="col-sort" v-model.number="formSort" type="number" min="1" step="1" />
              <p v-if="sortInvalid" role="alert" class="text-xs font-medium text-destructive">
                Order must be a whole number of 1 or more.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="moveDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move task</DialogTitle>
          <DialogDescription>
            {{ moveTask?.title }} — New and Awaiting Review are not offered; those moves go
            through return-to-pool and submission.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="moveError" variant="destructive">
          <AlertTitle>Could not move it</AlertTitle>
          <AlertDescription>{{ moveError }}</AlertDescription>
        </Alert>

        <div v-if="moveTask" class="space-y-2 py-2">
          <Label>Move to column</Label>
          <Select v-model="moveColumnId">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Pick a column" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="column in moveTargets(moveTask)" :key="column.id" :value="column.id">
                {{ column.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="isMoving" @click="moveDialogOpen = false">Cancel</Button>
          <Button :disabled="!moveColumnId || isMoving" @click="performMove">
            {{ isMoving ? 'Moving…' : 'Move task' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="removeDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this column?</AlertDialogTitle>
          <AlertDialogDescription>
            “{{ removeTarget?.name }}” will be removed from the board.
            If it still holds an active task, the board skips the removal and says so instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isRemoving">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="isRemoving"
            @click.prevent="performRemove"
          >
            {{ isRemoving ? 'Removing…' : 'Remove column' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
