<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { MasterDepartment } from '~/utils/clientFakeApi'
import { relativeTime } from '~/utils/task-ui'

/**
 * The master department catalogue (feat/department-crud), operator-only. A
 * master is global — no hotel scope — and hotels enable it from their own
 * Departments screen. Retiring one (isActive false) stops NEW enablement
 * only: hotels already using it keep it. Delete is a hard delete allowed only
 * while no hotel has EVER used it; otherwise the API answers 409 and says to
 * deactivate instead.
 */
const api = useTasksApi()

const rows = ref<MasterDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formCode = ref('')
const formDescription = ref('')
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit master department' : 'New master department'))
const canSave = computed(() => !isSaving.value && Boolean(formName.value.trim()))

const deleteTarget = ref<MasterDepartment | null>(null)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    rows.value = await api.listMasterDepartments()
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
  formCode.value = ''
  formDescription.value = ''
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(dept: MasterDepartment) {
  editId.value = dept.id
  formName.value = dept.name
  formCode.value = dept.code ?? ''
  formDescription.value = dept.description ?? ''
  formActive.value = dept.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  try {
    if (editId.value) {
      // JSON null reads as "unchanged" on this PATCH, so a cleared field is
      // sent as "" — what the form shows is what is saved.
      await api.updateMasterDepartment(editId.value, {
        name: formName.value.trim(),
        code: formCode.value.trim(),
        description: formDescription.value.trim(),
        isActive: formActive.value,
      })
    }
    else {
      await api.createMasterDepartment({
        name: formName.value.trim(),
        code: formCode.value.trim() || null,
        description: formDescription.value.trim() || null,
      })
    }
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

async function performDelete() {
  const target = deleteTarget.value
  if (!target || isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await api.deleteMasterDepartment(target.id)
    deleteTarget.value = null
    await load()
  }
  catch (e) {
    // "department is used by N hotel(s); deactivate it instead" — the API's words, as is.
    errorMessage.value = (e as Error).message
    deleteTarget.value = null
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
      title="Master departments"
      description="The platform-wide department vocabulary every property enables from. Keeps reporting comparable across the group."
      :icon="LayersIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New master department
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

    <TableSkeleton v-if="isLoading && rows.length === 0" :rows="5" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead class="w-28">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="dept in rows" :key="dept.id" :class="dept.isActive ? '' : 'opacity-55'">
                <TableCell class="font-medium text-foreground">{{ dept.name }}</TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">{{ dept.code ?? '—' }}</TableCell>
                <TableCell class="max-w-80 truncate text-muted-foreground" :title="dept.description ?? ''">{{ dept.description ?? '—' }}</TableCell>
                <TableCell>
                  <Badge :variant="dept.isActive ? 'success' : 'secondary'">{{ dept.isActive ? 'Active' : 'Retired' }}</Badge>
                </TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">{{ relativeTime(dept.updatedAt) }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" :aria-label="`Edit ${dept.name}`" @click="openEdit(dept)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      :aria-label="`Delete ${dept.name}`"
                      @click="deleteTarget = dept"
                    >
                      <Trash2Icon />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && rows.length === 0">
                <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                  No master departments yet.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>
            <template v-if="editId">
              Hotels that enabled this department follow its name, code and description. Retiring it stops new enablement only.
            </template>
            <template v-else>
              Available to every property as soon as it is created; each hotel enables it from its own Departments screen.
            </template>
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_9rem]">
            <div class="space-y-2">
              <Label for="master-name">Name</Label>
              <Input id="master-name" v-model="formName" placeholder="e.g. Housekeeping" maxlength="100" />
            </div>
            <div class="space-y-2">
              <Label for="master-code">Code</Label>
              <Input id="master-code" v-model="formCode" class="font-mono uppercase" placeholder="HK" maxlength="16" />
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            Code: optional, 1-16 of A-Z, 0-9 or _, stored upper-case, unique across the catalogue.
            {{ editId ? 'Leave it blank to clear it.' : '' }}
          </p>

          <div class="space-y-2">
            <Label for="master-description">Description</Label>
            <Textarea id="master-description" v-model="formDescription" rows="3" maxlength="500" placeholder="What this department covers (optional, up to 500 characters)" />
            <p v-if="editId" class="text-xs text-muted-foreground">Leave it blank to clear it.</p>
          </div>

          <div v-if="editId" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="master-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Retired: no property can newly enable or reactivate it; those already using it keep it.</p>
            </div>
            <Switch id="master-active" v-model="formActive" />
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

    <AlertDialog :open="Boolean(deleteTarget)" @update:open="value => { if (!value) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {{ deleteTarget?.name }}?</AlertDialogTitle>
          <AlertDialogDescription>
            A hard delete, allowed only while no property has ever enabled it. Once any hotel has used it the API refuses —
            retire it from Edit instead. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="isSaving"
            @click.prevent="performDelete"
          >
            {{ isSaving ? 'Deleting…' : 'Delete' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
