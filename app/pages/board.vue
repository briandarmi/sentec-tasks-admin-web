<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, SquareKanbanIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { BoardColumn, BoardWithColumns, TaskListItem, TaskPriority, TaskStatus } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES, priorityMeta, statusMeta } from '~/utils/task-ui'

const api = useTasksApi()

const board = ref<BoardWithColumns | null>(null)
const tasks = ref<TaskListItem[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formDescription = ref('')
const formStatus = ref<TaskStatus>('NEW')
const formSort = ref(1)
const formActive = ref(true)

const STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']

const columns = computed(() => board.value?.columns ?? [])
const dialogTitle = computed(() => (editId.value ? 'Edit column' : 'New column'))

/**
 * A board with no NEW column has nowhere to put arriving work, which is a
 * silent failure at dispatch time — worth flagging here rather than debugging
 * later from an empty board.
 */
const missingNewColumn = computed(() => columns.value.length > 0 && !columns.value.some(c => c.status === 'NEW'))

/** Whole number, 1 or more — the API refuses anything else. */
function isValidSort(value: unknown) {
  return Number.isInteger(Number(value)) && Number(value) >= 1
}

const sortInvalid = computed(() => !isValidSort(formSort.value))
const canSave = computed(() => !isSaving.value && Boolean(formName.value.trim()) && !sortInvalid.value)

// ── column removal ────────────────────────────────────────────────────────────

const removeDialogOpen = ref(false)
const isRemoving = ref(false)
/** Snapshotted at request time so the dialog names the right column. */
const removeTarget = ref<{ id: string, name: string } | null>(null)
/**
 * A skipped removal comes back as a 200 with a warning, not an error — the
 * column stays and the server explains why. It renders as its own alert so a
 * "success" that did nothing is never mistaken for one that did.
 */
const removeWarning = ref('')

function requestRemove(column: BoardColumn) {
  removeTarget.value = { id: column.id, name: column.name }
  removeDialogOpen.value = true
}

async function performRemove() {
  const target = removeTarget.value
  if (!target || isRemoving.value) return
  isRemoving.value = true
  errorMessage.value = ''
  removeWarning.value = ''
  try {
    const result = await api.removeBoardColumn(target.id)
    if (!result.removed) removeWarning.value = result.warning ?? 'The removal was skipped.'
    await load()
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

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedBoard, loadedTasks] = await Promise.all([
      api.getBoard(),
      api.listTasks({ limit: 200 }),
    ])
    board.value = loadedBoard
    tasks.value = loadedTasks.data
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

// ── direct task editing ───────────────────────────────────────────────────────

/** Tasks by column, for the kanban preview below the config table. */
const tasksByColumn = computed(() => {
  const grouped = new Map<string, TaskListItem[]>()
  for (const task of tasks.value) {
    if (!task.columnId) continue
    const bucket = grouped.get(task.columnId) ?? []
    bucket.push(task)
    grouped.set(task.columnId, bucket)
  }
  return grouped
})

/**
 * The API refuses moves the lifecycle forbids (into New or Awaiting Review,
 * cancelling closed work) — don't offer what will bounce. A SUBMITTED task is
 * frozen entirely: review is the only move, and it lives with the reviewer.
 */
function moveTargets(task: TaskListItem) {
  return columns.value.filter((column) => {
    if (column.id === task.columnId) return false
    if (column.status === 'NEW' || column.status === 'SUBMITTED') return false
    if (column.status === 'CANCELLED' && !['NEW', 'IN_PROGRESS', 'PENDING'].includes(task.status)) return false
    return true
  })
}

const taskDialogOpen = ref(false)
const isSavingTask = ref(false)
const taskFormError = ref('')
const editTask = ref<TaskListItem | null>(null)
const taskTitle = ref('')
const taskDescription = ref('')
const taskPriority = ref<TaskPriority>('NORMAL')
/** Empty = leave the task where it is. */
const taskColumnId = ref('')

const editTaskFrozen = computed(() => editTask.value?.status === 'SUBMITTED')

function openTaskEdit(task: TaskListItem) {
  editTask.value = task
  taskTitle.value = task.title
  taskDescription.value = task.description ?? ''
  taskPriority.value = task.priority
  taskColumnId.value = ''
  taskFormError.value = ''
  taskDialogOpen.value = true
}

async function saveTask() {
  const task = editTask.value
  if (!task || isSavingTask.value) return
  isSavingTask.value = true
  taskFormError.value = ''
  try {
    await api.updateTask({
      taskId: task.id,
      title: taskTitle.value,
      description: taskDescription.value.trim() || null,
      priority: taskPriority.value,
    })
    if (taskColumnId.value && taskColumnId.value !== task.columnId) {
      await api.moveTask({ taskId: task.id, columnId: taskColumnId.value })
    }
    await load()
    taskDialogOpen.value = false
  }
  catch (e) {
    // The edit may have landed even when the move failed — reload either way
    // on the next open; the dialog stays up with the server's reason.
    taskFormError.value = (e as Error).message
  }
  finally {
    isSavingTask.value = false
  }
}

function openCreate() {
  editId.value = undefined
  formName.value = ''
  formDescription.value = ''
  formStatus.value = 'IN_PROGRESS'
  formSort.value = columns.value.length + 1
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(column: BoardColumn) {
  editId.value = column.id
  formName.value = column.name
  formDescription.value = column.description ?? ''
  formStatus.value = column.status
  formSort.value = column.columnSort
  formActive.value = column.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertBoardColumn({
      id: editId.value,
      name: formName.value,
      description: formDescription.value.trim() || null,
      status: formStatus.value,
      columnSort: Number(formSort.value),
      isActive: formActive.value,
    })
    await load()
    dialogOpen.value = false
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
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

    <Alert v-if="removeWarning">
      <AlertTitle>Removal skipped</AlertTitle>
      <AlertDescription>{{ removeWarning }}</AlertDescription>
    </Alert>

    <Alert v-if="missingNewColumn" variant="destructive">
      <AlertTitle>No column maps to “New”</AlertTitle>
      <AlertDescription>
        Arriving tasks have nowhere to land and will not appear on the board. Point one column at the New status.
      </AlertDescription>
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
                  <span class="inline-flex items-center gap-2 text-sm text-foreground">
                    <span class="h-2 w-2 rounded-full" :class="statusMeta(column.status).dot" />
                    {{ statusMeta(column.status).label }}
                  </span>
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" :aria-label="`Edit ${column.name}`" @click="openEdit(column)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
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

      <!-- The board itself, in the staff-facing order, with direct editing:
           the effect of a config change is visible without leaving the page. -->
      <Card class="rounded-xl">
        <CardHeader>
          <CardTitle class="text-base font-semibold">The board</CardTitle>
          <CardDescription>{{ board.name }} — click a task to edit it or move it to another column.</CardDescription>
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
                  <span class="h-2 w-2 rounded-full" :class="statusMeta(column.status).dot" />
                  {{ column.name }}
                  <span class="ml-auto tabular-nums text-muted-foreground">{{ (tasksByColumn.get(column.id) ?? []).length }}</span>
                </p>
                <div class="space-y-2">
                  <button
                    v-for="task in tasksByColumn.get(column.id) ?? []"
                    :key="task.id"
                    type="button"
                    class="w-full rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    @click="openTaskEdit(task)"
                  >
                    <p class="text-xs font-semibold leading-snug text-foreground">{{ task.title }}</p>
                    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        v-if="task.priority !== 'NORMAL'"
                        class="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        :class="priorityMeta(task.priority).badge"
                      >{{ priorityMeta(task.priority).label }}</span>
                      <span v-if="task.location" class="text-[10px] text-muted-foreground">{{ task.location }}</span>
                      <span v-if="task.partner" class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        ·
                        <span
                          v-if="task.partner.badgeColor"
                          class="h-1.5 w-1.5 rounded-full"
                          :style="{ backgroundColor: task.partner.badgeColor }"
                          aria-hidden="true"
                        />
                        {{ task.partner.name }}
                      </span>
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
      description="Boards are provisioned during onboarding. Ask an operator to create one."
    />

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Columns are what staff drag work between.</DialogDescription>
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
              <Select v-model="formStatus">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="status in STATUSES" :key="status" :value="status">
                    {{ statusMeta(status).label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <!-- The column→status mapping is what drives SLA measurement, so
                   it is not cosmetic. -->
              <p class="text-xs text-muted-foreground">Moving a task here sets this status and stops the matching SLA clock.</p>
            </div>
            <div class="space-y-2">
              <Label for="col-sort">Order</Label>
              <Input id="col-sort" v-model.number="formSort" type="number" min="1" step="1" />
              <p v-if="sortInvalid" role="alert" class="text-xs font-medium text-destructive">
                Order must be a whole number of 1 or more.
              </p>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <Label for="col-active" class="cursor-pointer">Active</Label>
            <Switch id="col-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="taskDialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Changes apply immediately; every edit lands in the task's history.</DialogDescription>
        </DialogHeader>

        <Alert v-if="taskFormError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ taskFormError }}</AlertDescription>
        </Alert>

        <Alert v-if="editTaskFrozen">
          <AlertTitle>Awaiting review</AlertTitle>
          <AlertDescription>A submitted task is with its reviewer — it can be edited, but only the review decision moves it.</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="task-title">Title</Label>
            <Input id="task-title" v-model="taskTitle" />
          </div>
          <div class="space-y-2">
            <Label for="task-desc">Description</Label>
            <Input id="task-desc" v-model="taskDescription" placeholder="Optional" />
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Priority</Label>
              <Select v-model="taskPriority">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">
                    {{ priorityMeta(priority).label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div v-if="editTask && !editTaskFrozen" class="space-y-2">
              <Label>Move to column</Label>
              <Select v-model="taskColumnId">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Keep where it is" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="column in moveTargets(editTask)" :key="column.id" :value="column.id">
                    {{ column.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">New and Awaiting Review are not offered — those moves go through return-to-pool and submission.</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSavingTask" @click="taskDialogOpen = false">Cancel</Button>
          <Button :disabled="isSavingTask || !taskTitle.trim()" @click="saveTask">
            {{ isSavingTask ? 'Saving…' : 'Save task' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="removeDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this column?</AlertDialogTitle>
          <AlertDialogDescription>
            “{{ removeTarget?.name }}” will be removed from the board. This cannot be undone.
            If the column still has an open task, the removal is skipped instead.
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
