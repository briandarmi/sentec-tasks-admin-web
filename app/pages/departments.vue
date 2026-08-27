<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2Icon, PencilIcon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Department } from '~/utils/clientFakeApi'

const api = useTasksApi()

const departments = ref<Department[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit department' : 'New department'))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    departments.value = await api.listDepartments()
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
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(department: Department) {
  editId.value = department.id
  formName.value = department.name
  formActive.value = department.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertDepartment({ id: editId.value, name: formName.value, isActive: formActive.value })
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
      title="Departments"
      description="Work is routed to a department, then picked up by its staff."
      :icon="Building2Icon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New department
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && departments.length === 0" :rows="4" :columns="3" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="department in departments" :key="department.id">
              <TableCell class="font-medium text-foreground">{{ department.name }}</TableCell>
              <TableCell>
                <Badge :variant="department.isActive ? 'success' : 'secondary'">
                  {{ department.isActive ? 'Active' : 'Inactive' }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" @click="openEdit(department)">
                  <PencilIcon />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!isLoading && departments.length === 0">
              <TableCell colspan="3" class="py-10 text-center text-sm text-muted-foreground">
                No departments yet. Create one so routing rules have a destination.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Departments are per property.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="dept-name">Name</Label>
            <Input id="dept-name" v-model="formName" placeholder="Housekeeping" />
          </div>
          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="dept-active" class="cursor-pointer">Active</Label>
              <!-- Deactivating keeps history intact but stops new routing, which
                   is why this is a toggle rather than a delete. -->
              <p class="text-xs text-muted-foreground">Inactive departments keep their history but take no new work.</p>
            </div>
            <Switch id="dept-active" v-model="formActive" />
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
