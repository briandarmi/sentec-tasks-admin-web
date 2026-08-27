<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, SquareKanbanIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { BoardColumn, BoardWithColumns, TaskStatus } from '~/utils/clientFakeApi'
import { statusMeta } from '~/utils/task-ui'

const api = useTasksApi()

const board = ref<BoardWithColumns | null>(null)
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

const STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']

const columns = computed(() => board.value?.columns ?? [])
const dialogTitle = computed(() => (editId.value ? 'Edit column' : 'New column'))

/**
 * A board with no NEW column has nowhere to put arriving work, which is a
 * silent failure at dispatch time — worth flagging here rather than debugging
 * later from an empty board.
 */
const missingNewColumn = computed(() => columns.value.length > 0 && !columns.value.some(c => c.status === 'NEW'))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    board.value = await api.getBoard()
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
                  <Button size="sm" variant="outline" @click="openEdit(column)">
                    <PencilIcon />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Preview of the staff-facing order, so the effect of a sort change is
           visible without leaving the page. -->
      <Card class="rounded-xl">
        <CardHeader>
          <CardTitle class="text-base font-semibold">How staff will see it</CardTitle>
          <CardDescription>{{ board.name }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="column in columns"
              :key="column.id"
              class="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold"
            >
              <span class="h-2 w-2 rounded-full" :class="statusMeta(column.status).dot" />
              {{ column.name }}
            </span>
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
              <Input id="col-sort" v-model.number="formSort" type="number" min="1" />
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <Label for="col-active" class="cursor-pointer">Active</Label>
            <Switch id="col-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formName.trim()" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
