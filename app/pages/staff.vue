<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, UsersIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { HotelDepartment, Staff } from '~/utils/clientFakeApi'

/**
 * Staff accounts at this hotel. The real API's rules, kept visible here:
 * creation mints `staff` or `leader` ONLY — admin is granted by a second,
 * separate PATCH (the two-step promotion), so no one becomes an admin by a
 * typo in a picker. Deactivation is a PATCH too; nothing is ever deleted.
 */
const api = useTasksApi()
const session = useSession()

const rows = ref<Staff[]>([])
const departments = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formEmail = ref('')
const formName = ref('')
const formPassword = ref('')
const formRole = ref<'staff' | 'leader' | 'admin'>('staff')
const formDepartmentId = ref('')
const formCreateTask = ref(true)
const formActive = ref(true)
/** Create-only: queue the admin promotion as an immediate second request. */
const formPromoteToAdmin = ref(false)
/** Set when the create landed but the queued promotion failed alone. */
const promotionWarning = ref('')

const dialogTitle = computed(() => (editId.value ? 'Edit member' : 'Add member'))
const departmentName = (id: string | null) => departments.value.find(d => d.id === id)?.departmentName ?? '—'

const canSave = computed(() => {
  if (isSaving.value || !formName.value.trim()) return false
  if (editId.value) return true
  return formEmail.value.includes('@') && formPassword.value.length >= 10
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [staffRows, deptRows] = await Promise.all([api.listStaff(), api.listHotelDepartments()])
    rows.value = staffRows
    departments.value = deptRows
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
  formEmail.value = ''
  formName.value = ''
  formPassword.value = ''
  formRole.value = 'staff'
  formDepartmentId.value = ''
  formCreateTask.value = true
  formActive.value = true
  formPromoteToAdmin.value = false
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(member: Staff) {
  editId.value = member.id
  formEmail.value = member.email
  formName.value = member.name
  formPassword.value = ''
  formRole.value = member.role
  formDepartmentId.value = member.hotelDepartmentId ?? ''
  formCreateTask.value = member.createTask
  formActive.value = member.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  promotionWarning.value = ''
  try {
    if (editId.value) {
      // Email and password are immutable through this route by design.
      await api.updateStaff(editId.value, {
        name: formName.value.trim(),
        role: formRole.value,
        hotelDepartmentId: formDepartmentId.value || null,
        createTask: formCreateTask.value,
        isActive: formActive.value,
      })
    }
    else {
      // The API refuses role=admin at creation; promotion is a second request.
      const created = await api.createStaff({
        email: formEmail.value.trim(),
        name: formName.value.trim(),
        password: formPassword.value,
        role: formRole.value === 'admin' ? 'leader' : formRole.value,
        hotels: session.hotelId.value ? [session.hotelId.value] : [],
        hotelDepartmentId: formDepartmentId.value || null,
        createTask: formCreateTask.value,
      })
      if (formPromoteToAdmin.value) {
        try {
          await api.updateStaff(created.id, { role: 'admin' })
        }
        catch (e) {
          // The account exists; only the promotion failed. Say exactly that.
          promotionWarning.value = `${created.name} was created, but the admin promotion failed: ${(e as Error).message}. Promote them from Edit.`
        }
      }
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

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Staff"
      description="Accounts with access to this property. Admin is granted by promotion, never at creation."
      :icon="UsersIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          Add member
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

    <Alert v-if="promotionWarning">
      <AlertTitle>Created, but not promoted</AlertTitle>
      <AlertDescription>{{ promotionWarning }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && rows.length === 0" :rows="5" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Can raise tasks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="member in rows" :key="member.id" :class="member.isActive ? '' : 'opacity-55'">
                <TableCell>
                  <p class="font-medium text-foreground">{{ member.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ member.email }}</p>
                </TableCell>
                <TableCell class="capitalize text-foreground">{{ member.role }}</TableCell>
                <TableCell class="text-foreground">{{ departmentName(member.hotelDepartmentId) }}</TableCell>
                <TableCell>
                  <Badge :variant="member.createTask ? 'outline' : 'secondary'">{{ member.createTask ? 'Yes' : 'No' }}</Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="member.isActive ? 'success' : 'secondary'">{{ member.isActive ? 'Active' : 'Inactive' }}</Badge>
                </TableCell>
                <TableCell class="text-right">
                  <Button size="sm" variant="outline" :aria-label="`Edit ${member.name}`" @click="openEdit(member)">
                    <PencilIcon />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && rows.length === 0">
                <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                  Nobody here yet.
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
            {{ editId ? 'Email and password never change through this console.' : 'New accounts start as staff or leader; admin is a promotion.' }}
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="member-name">Name</Label>
              <Input id="member-name" v-model="formName" placeholder="Full name" />
            </div>
            <div class="space-y-2">
              <Label for="member-email">Email</Label>
              <Input id="member-email" v-model="formEmail" type="email" :disabled="Boolean(editId)" placeholder="name@property.example" />
            </div>
          </div>

          <div v-if="!editId" class="space-y-2">
            <Label for="member-password">Password</Label>
            <Input id="member-password" v-model="formPassword" type="password" autocomplete="new-password" placeholder="At least 10 characters" />
            <p v-if="formPassword && formPassword.length < 10" role="alert" class="text-xs font-medium text-destructive">
              The API requires at least 10 characters.
            </p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Role</Label>
              <Select v-model="formRole">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="leader">Leader</SelectItem>
                  <!-- Promotion path only: the create route refuses admin. -->
                  <SelectItem v-if="editId" value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Department</Label>
              <Select :model-value="toSelectValue(formDepartmentId)" @update:model-value="value => formDepartmentId = fromSelectValue(value) ?? ''">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="SELECT_EMPTY">No department</SelectItem>
                  <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.departmentName }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-create-task" class="cursor-pointer">Can raise tasks</Label>
              <p class="text-xs text-muted-foreground">The createTask claim — leaders and admins may always.</p>
            </div>
            <Switch id="member-create-task" v-model="formCreateTask" />
          </div>

          <div v-if="!editId" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-promote" class="cursor-pointer">Promote to admin right after</Label>
              <p class="text-xs text-muted-foreground">
                Two requests: create as leader, then promote. The second can fail alone — the screen will say so.
              </p>
            </div>
            <Switch id="member-promote" v-model="formPromoteToAdmin" />
          </div>

          <div v-if="editId" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Deactivating blocks sign-in; nothing is deleted.</p>
            </div>
            <Switch id="member-active" v-model="formActive" />
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
  </div>
</template>
