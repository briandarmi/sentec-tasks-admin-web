<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, StarIcon, TimerIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Sla } from '~/utils/clientFakeApi'
import { formatMinutes } from '~/utils/task-ui'

const api = useTasksApi()

const slas = ref<Sla[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formResponse = ref(15)
const formResolution = ref(45)
const formDefault = ref(false)

const dialogTitle = computed(() => (editId.value ? 'Edit SLA' : 'New SLA'))
/** Both budgets count from activation, so resolution IS the total window. */
const totalWindow = computed(() => formatMinutes(Number(formResolution.value || 0)))

/**
 * Whole minutes only, enforced by disabling Save rather than rounding: "15.5"
 * quietly becoming a real SLA target is the same class of risk as a
 * seconds/minutes conversion bug. The API refuses fractions too.
 */
function isValidMinutes(value: unknown) {
  return Number.isInteger(Number(value)) && Number(value) >= 1
}

const minutesInvalid = computed(() => !isValidMinutes(formResponse.value) || !isValidMinutes(formResolution.value))
/** Resolution can't come before response when both run from activation. */
const orderingInvalid = computed(() => !minutesInvalid.value && Number(formResolution.value) < Number(formResponse.value))
const canSave = computed(() => !isSaving.value && Boolean(formName.value.trim()) && !minutesInvalid.value && !orderingInvalid.value)

// Replacing the property's default re-targets every task no rule routes, so it
// is confirmed by name rather than flipped by a switch alone.
const defaultDialogOpen = ref(false)

function requestSave() {
  if (isSaving.value || !canSave.value) return
  const currentDefault = slas.value.find(s => s.isDefault)
  if (formDefault.value && currentDefault && currentDefault.id !== editId.value) {
    defaultDialogOpen.value = true
    return
  }
  void save()
}

function confirmDefault() {
  defaultDialogOpen.value = false
  void save()
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    slas.value = await api.listSlas()
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
  formResponse.value = 15
  formResolution.value = 45
  formDefault.value = slas.value.length === 0
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(sla: Sla) {
  editId.value = sla.id
  formName.value = sla.name
  formResponse.value = sla.responseTime
  formResolution.value = sla.resolutionTime
  formDefault.value = sla.isDefault
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertSla({
      id: editId.value,
      name: formName.value,
      responseTime: Number(formResponse.value),
      resolutionTime: Number(formResolution.value),
      isDefault: formDefault.value,
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
      title="SLAs"
      description="Response and resolution targets, stamped on a task the moment it arrives."
      :icon="TimerIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New SLA
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <Card class="rounded-xl">
      <CardContent>
        <div class="flex items-start gap-3">
          <TimerIcon class="mt-0.5 shrink-0 text-primary" />
          <p class="text-sm text-foreground">
            <span class="font-semibold">Response</span> is the budget until someone starts the task;
            <span class="font-semibold">resolution</span> is the budget until the work is submitted.
            Both count from activation, and both tick only while the owning department is open.
            A task with no matching routing rule falls back to the property default.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && slas.length === 0" :rows="4" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Response</TableHead>
              <TableHead>Resolution</TableHead>
              <TableHead />
              <TableHead class="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="sla in slas" :key="sla.id">
              <TableCell class="font-medium text-foreground">{{ sla.name }}</TableCell>
              <TableCell class="text-foreground">{{ formatMinutes(sla.responseTime) }}</TableCell>
              <TableCell class="text-foreground">{{ formatMinutes(sla.resolutionTime) }}</TableCell>
              <TableCell>
                <Badge v-if="sla.isDefault" variant="success">
                  <StarIcon />
                  Default
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" @click="openEdit(sla)">
                  <PencilIcon />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!isLoading && slas.length === 0">
              <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                No SLAs yet.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Both targets are in minutes.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="sla-name">Name</Label>
            <Input id="sla-name" v-model="formName" placeholder="e.g. Urgent" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="sla-response">Response (minutes)</Label>
              <Input id="sla-response" v-model.number="formResponse" type="number" min="1" step="1" />
            </div>
            <div class="space-y-2">
              <Label for="sla-resolution">Resolution (minutes)</Label>
              <Input id="sla-resolution" v-model.number="formResolution" type="number" min="1" step="1" />
            </div>
          </div>

          <p v-if="minutesInvalid" role="alert" class="text-xs font-medium text-destructive">
            Both targets must be whole minutes, at least 1.
          </p>
          <p v-else-if="orderingInvalid" role="alert" class="text-xs font-medium text-destructive">
            Resolution cannot be shorter than response — both count from activation.
          </p>
          <p v-else class="text-xs text-muted-foreground">
            A task on this SLA is late after <span class="font-semibold text-foreground">{{ totalWindow }}</span> of open hours.
          </p>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="sla-default" class="cursor-pointer">Property default</Label>
              <!-- Exactly one default per property; setting this one clears the
                   other, which is worth stating before the click. -->
              <p class="text-xs text-muted-foreground">Used when no routing rule matches. Replaces the current default.</p>
            </div>
            <Switch id="sla-default" v-model="formDefault" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="requestSave">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="defaultDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change the default SLA?</AlertDialogTitle>
          <AlertDialogDescription>
            Making “{{ formName }}” the default re-targets every task that no routing rule sends to a specific SLA.
            Already-routed tasks are not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDefault">Set as default</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
