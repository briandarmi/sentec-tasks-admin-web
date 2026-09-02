<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, ShieldCheckIcon, UserRoundPlusIcon, UsersIcon } from '@lucide/vue'
import { useTasksApi, type StaffMember } from '~/composables/useTasksApi'
import type { Department, TenantRole } from '~/utils/clientFakeApi'
import { initials } from '~/utils/task-ui'

const api = useTasksApi()

const members = ref<StaffMember[]>([])
const departments = ref<Department[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editProfileId = ref<string | undefined>()
/** Whether the member being edited was active when the dialog opened —
 *  deactivation (and only deactivation) is confirmed by name. */
const editWasActive = ref(true)
const formEmail = ref('')
const formFirstName = ref('')
const formLastName = ref('')
const formPosition = ref('')
const formRole = ref<TenantRole>('staff')
/** Create-only: promote to admin in a second step after the account exists. */
const formPromote = ref(false)
const formDepartmentId = ref('')
const formCanCreate = ref(true)
const formActive = ref(true)

const isEditing = computed(() => Boolean(editProfileId.value))
const dialogTitle = computed(() => (isEditing.value ? 'Edit team member' : 'Add staff'))

const ROLE_LABELS: Record<TenantRole, string> = {
  staff: 'Staff',
  leader: 'Team Leader',
  admin: 'Property Admin',
}

/**
 * Creation offers staff and leader only: admin cannot be granted at creation.
 * A new account that needs it is created first, then promoted in a second,
 * deliberate request — the API refuses a create that says admin.
 */
const CREATE_ROLES: TenantRole[] = ['staff', 'leader']
const ALL_ROLES: TenantRole[] = ['staff', 'leader', 'admin']

const roleOptions = computed(() => (isEditing.value ? ALL_ROLES : CREATE_ROLES))

const departmentName = computed(() => new Map(departments.value.map(d => [d.id, d.name])))

/** Grouped by role so the shape of the team is readable at a glance. */
const byRole = computed(() => (['admin', 'leader', 'staff'] as TenantRole[])
  .map(role => ({ role, members: members.value.filter(m => m.role === role) }))
  .filter(group => group.members.length > 0))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedMembers, loadedDepartments] = await Promise.all([api.listStaff(), api.listDepartments()])
    members.value = loadedMembers
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
  editProfileId.value = undefined
  editWasActive.value = true
  formEmail.value = ''
  formFirstName.value = ''
  formLastName.value = ''
  formPosition.value = ''
  formRole.value = 'staff'
  formPromote.value = false
  formDepartmentId.value = departments.value[0]?.id ?? ''
  formCanCreate.value = true
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(member: StaffMember) {
  editProfileId.value = member.profileId
  editWasActive.value = member.isActive
  formEmail.value = member.email
  formFirstName.value = member.firstName
  formLastName.value = member.lastName
  formPosition.value = member.position ?? ''
  formRole.value = member.role
  formPromote.value = false
  formDepartmentId.value = member.departmentId ?? ''
  formCanCreate.value = member.canCreateTask
  formActive.value = member.isActive
  formError.value = ''
  dialogOpen.value = true
}

// ── deactivation confirmation ─────────────────────────────────────────────────

const deactivateDialogOpen = ref(false)
const deactivateName = computed(() => `${formFirstName.value} ${formLastName.value}`.trim() || formEmail.value)

function requestSave() {
  if (isSaving.value) return
  // Deactivating removes someone's access; reactivating merely restores what
  // was already granted once, so only the former asks first.
  if (isEditing.value && editWasActive.value && !formActive.value) {
    deactivateDialogOpen.value = true
    return
  }
  void save()
}

function confirmDeactivate() {
  deactivateDialogOpen.value = false
  void save()
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    const saved = await api.upsertStaff({
      profileId: editProfileId.value,
      email: formEmail.value.trim(),
      firstName: formFirstName.value.trim(),
      lastName: formLastName.value.trim(),
      position: formPosition.value.trim() || null,
      role: formRole.value,
      departmentId: formDepartmentId.value || null,
      canCreateTask: formCanCreate.value,
      isActive: formActive.value,
    })

    // Two-step promotion: the account is created with the role above, then a
    // SEPARATE request grants admin. Never folded into the create — if the
    // create failed there is nothing to promote, and if this step fails the
    // account still exists and the admin must hear that rather than navigate
    // away believing it worked.
    if (!isEditing.value && formPromote.value) {
      try {
        await api.upsertStaff({
          profileId: saved.id,
          position: formPosition.value.trim() || null,
          role: 'admin',
          departmentId: formDepartmentId.value || null,
          canCreateTask: formCanCreate.value,
          isActive: formActive.value,
        })
      }
      catch (e) {
        await load()
        formError.value = `${(e as Error).message} The account was still created — promote them by editing their row.`
        return
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
      description="Who works here, what they can do, and which department they belong to."
      :icon="UsersIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <UserRoundPlusIcon />
          Add staff
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

    <!-- Group grants are deliberately not editable here: only an operator can
         issue one, and never to themselves. Saying so stops the search for a
         missing button. -->
    <Alert>
      <ShieldCheckIcon />
      <AlertTitle>Admin is granted by promotion; brand-wide access by an operator</AlertTitle>
      <AlertDescription>
        New accounts are added as staff or team leaders — admin cannot be granted at creation, only by promoting an
        existing member (the “add” form can queue that as an immediate second step). Access spanning a whole brand is
        a group grant, which only Sentinel Tech operators can give or take away, and every change lands in the audit trail.
      </AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && members.length === 0" :rows="6" :columns="5" />

    <section v-for="group in byRole" v-else :key="group.role" class="space-y-3">
      <h2 class="text-sm font-bold uppercase tracking-widest text-muted-foreground">
        {{ ROLE_LABELS[group.role] }} ({{ group.members.length }})
      </h2>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Open work</TableHead>
                  <TableHead>Can raise tasks</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="member in group.members" :key="member.profileId">
                  <TableCell>
                    <div class="flex items-center gap-3">
                      <Avatar class="h-8 w-8 shrink-0">
                        <AvatarFallback class="bg-primary/10 text-[10px] font-semibold text-primary">
                          {{ initials(member) }}
                        </AvatarFallback>
                      </Avatar>
                      <div class="min-w-0">
                        <p class="truncate font-medium text-foreground">{{ member.firstName }} {{ member.lastName }}</p>
                        <p class="truncate text-xs text-muted-foreground">{{ member.position || member.email }}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell class="text-foreground">
                    {{ member.departmentId ? departmentName.get(member.departmentId) ?? '—' : 'All departments' }}
                  </TableCell>
                  <TableCell>
                    <Badge :variant="member.openTaskCount > 0 ? 'secondary' : 'outline'" class="tabular-nums">
                      {{ member.openTaskCount }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge :variant="member.canCreateTask ? 'success' : 'secondary'">
                      {{ member.canCreateTask ? 'Yes' : 'No' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      :aria-label="`Edit ${member.firstName} ${member.lastName}`"
                      @click="openEdit(member)"
                    >
                      <PencilIcon />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>

    <EmptyState
      v-if="!isLoading && members.length === 0"
      :icon="UsersIcon"
      title="Nobody here yet"
      description="Add the people who work at this property."
    />

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>
            {{ isEditing ? 'Changes apply at this property only.' : 'They\'ll be matched by email if they already work at another property.' }}
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="staff-email">Email</Label>
            <Input
              id="staff-email"
              v-model="formEmail"
              type="email"
              autocapitalize="none"
              spellcheck="false"
              :disabled="isEditing"
              placeholder="name@example.com"
            />
            <p v-if="isEditing" class="text-xs text-muted-foreground">Email identifies the person across properties, so it can't be changed here.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="staff-first">First name</Label>
              <Input id="staff-first" v-model="formFirstName" :disabled="isEditing" />
            </div>
            <div class="space-y-2">
              <Label for="staff-last">Last name</Label>
              <Input id="staff-last" v-model="formLastName" :disabled="isEditing" />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="staff-position">Position</Label>
            <Input id="staff-position" v-model="formPosition" placeholder="e.g. Room Attendant" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Role</Label>
              <Select v-model="formRole">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="role in roleOptions" :key="role" :value="role">{{ ROLE_LABELS[role] }}</SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">
                {{ isEditing
                  ? 'Role changes apply at this property only.'
                  : 'Admin cannot be granted at creation — use the promotion step below.' }}
              </p>
            </div>
            <div class="space-y-2">
              <Label>Department</Label>
              <Select :model-value="toSelectValue(formDepartmentId)" @update:model-value="value => formDepartmentId = fromSelectValue(value)">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="SELECT_EMPTY">All departments</SelectItem>
                  <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.name }}</SelectItem>
                </SelectContent>
              </Select>
              <!-- Department is what scopes a staff member's visible queue, so
                   leaving it empty is a real choice, not a blank field. -->
              <p class="text-xs text-muted-foreground">Staff see their own department's queue. Leave empty for cross-department cover.</p>
            </div>
          </div>

          <div v-if="!isEditing" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="staff-promote" class="cursor-pointer">Promote to admin after creating</Label>
              <!-- Said before the click, not discovered after: the create and
                   the promotion are two requests, and the second can fail alone. -->
              <p class="text-xs text-muted-foreground">
                The account is created with the role above, then immediately promoted to Property Admin in a second step.
              </p>
            </div>
            <Switch id="staff-promote" v-model="formPromote" />
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="staff-create" class="cursor-pointer">Can raise tasks</Label>
              <p class="text-xs text-muted-foreground">Lets them create work, not just pick it up.</p>
            </div>
            <Switch id="staff-create" v-model="formCanCreate" />
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="staff-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Turning this off removes their access to this property.</p>
            </div>
            <Switch id="staff-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button
            :disabled="isSaving || (!isEditing && (!formEmail.trim() || !formFirstName.trim()))"
            @click="requestSave"
          >
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deactivateDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate this team member?</AlertDialogTitle>
          <AlertDialogDescription>
            “{{ deactivateName }}” will no longer be able to sign in here or be assigned tasks.
            This can be reversed by activating them again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive text-white hover:bg-destructive-hover" @click="confirmDeactivate">
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
