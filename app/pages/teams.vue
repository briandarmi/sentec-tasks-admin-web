<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, UserRoundMinusIcon, UsersRoundIcon } from '@lucide/vue'
import { useTasksApi, type StaffMember } from '~/composables/useTasksApi'
import type { Department, Team } from '~/utils/clientFakeApi'
import { fullName } from '~/utils/task-ui'

const api = useTasksApi()

type TeamRow = Team & { memberCount: number }

const teams = ref<TeamRow[]>([])
const departments = ref<Department[]>([])
const staff = ref<StaffMember[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formDescription = ref('')
const formDepartmentId = ref('')
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit team' : 'New team'))
const canSave = computed(() => !isSaving.value && Boolean(formName.value.trim()))

const departmentName = computed(() => new Map(departments.value.map(d => [d.id, d.name])))

// ── members ───────────────────────────────────────────────────────────────────

const membersDialogOpen = ref(false)
const membersTeam = ref<TeamRow | null>(null)
/** Member user ids per team, fetched once and kept for the session. */
const membersByTeam = ref(new Map<string, string[]>())
const membersLoading = ref(false)
const membersError = ref('')
const addUserId = ref('')

/**
 * In-flight add/remove operations, keyed by `${teamId}:${userId}` — per
 * membership, not per team, so adding two different people concurrently is
 * fine while a double-click on one person is a single request. The key is
 * taken synchronously, before the first await: a check placed after it would
 * let the second click of a double-click straight through.
 */
const memberPending = ref(new Set<string>())

function memberKey(teamId: string, userId: string) {
  return `${teamId}:${userId}`
}

function isMemberPending(userId: string) {
  return membersTeam.value ? memberPending.value.has(memberKey(membersTeam.value.id, userId)) : false
}

const currentMembers = computed(() => {
  const team = membersTeam.value
  if (!team) return []
  const ids = membersByTeam.value.get(team.id) ?? []
  return ids.map(userId => ({
    userId,
    name: fullName(staff.value.find(s => s.userId === userId) ?? null) || `User ${userId}`,
  }))
})

const addableStaff = computed(() => {
  const team = membersTeam.value
  if (!team) return []
  const memberIds = new Set(membersByTeam.value.get(team.id) ?? [])
  return staff.value.filter(person => !memberIds.has(person.userId))
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedTeams, loadedDepartments, loadedStaff] = await Promise.all([
      api.listTeams(),
      api.listDepartments(),
      api.listStaff(),
    ])
    teams.value = loadedTeams
    departments.value = loadedDepartments
    staff.value = loadedStaff
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
  formDepartmentId.value = ''
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(team: TeamRow) {
  editId.value = team.id
  formName.value = team.name
  formDescription.value = team.description ?? ''
  formDepartmentId.value = team.departmentId ?? ''
  formActive.value = team.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertTeam({
      id: editId.value,
      name: formName.value,
      description: formDescription.value.trim() || null,
      departmentId: formDepartmentId.value || null,
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

async function openMembers(team: TeamRow) {
  membersTeam.value = team
  membersError.value = ''
  addUserId.value = ''
  membersDialogOpen.value = true
  // Fetched once per team, then kept: closing and reopening the dialog does
  // not refetch what we already have.
  if (membersByTeam.value.has(team.id)) return
  membersLoading.value = true
  try {
    const ids = await api.listTeamMembers(team.id)
    membersByTeam.value = new Map(membersByTeam.value).set(team.id, ids)
  }
  catch (e) {
    membersError.value = (e as Error).message
  }
  finally {
    membersLoading.value = false
  }
}

function setTeamMembers(teamId: string, ids: string[]) {
  membersByTeam.value = new Map(membersByTeam.value).set(teamId, ids)
  const team = teams.value.find(t => t.id === teamId)
  if (team) team.memberCount = ids.length
}

async function addMember() {
  const team = membersTeam.value
  const userId = addUserId.value
  if (!team || !userId) return
  const key = memberKey(team.id, userId)
  // Guard taken synchronously: the second click of a double-click lands in the
  // same tick the first request is still awaiting.
  if (memberPending.value.has(key)) return
  memberPending.value = new Set(memberPending.value).add(key)
  membersError.value = ''
  try {
    await api.addTeamMember(team.id, userId)
    setTeamMembers(team.id, [...(membersByTeam.value.get(team.id) ?? []), userId])
    addUserId.value = ''
  }
  catch (e) {
    membersError.value = (e as Error).message
  }
  finally {
    const next = new Set(memberPending.value)
    next.delete(key)
    memberPending.value = next
  }
}

async function removeMember(userId: string) {
  const team = membersTeam.value
  if (!team) return
  const key = memberKey(team.id, userId)
  if (memberPending.value.has(key)) return
  memberPending.value = new Set(memberPending.value).add(key)
  membersError.value = ''
  try {
    await api.removeTeamMember(team.id, userId)
    setTeamMembers(team.id, (membersByTeam.value.get(team.id) ?? []).filter(id => id !== userId))
  }
  catch (e) {
    membersError.value = (e as Error).message
  }
  finally {
    const next = new Set(memberPending.value)
    next.delete(key)
    memberPending.value = next
  }
}

const isAddPending = computed(() => Boolean(addUserId.value) && isMemberPending(addUserId.value))

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Teams"
      description="Working groups inside a department — a shift crew, an on-call rota — and who is on them."
      :icon="UsersRoundIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New team
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

    <TableSkeleton v-if="isLoading && teams.length === 0" :rows="4" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="team in teams" :key="team.id" :class="team.isActive ? '' : 'opacity-55'">
                <TableCell>
                  <p class="font-medium text-foreground">{{ team.name }}</p>
                  <p v-if="team.description" class="max-w-72 truncate text-xs text-muted-foreground">{{ team.description }}</p>
                </TableCell>
                <TableCell class="text-foreground">
                  {{ team.departmentId ? departmentName.get(team.departmentId) ?? '—' : 'Cross-department' }}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" class="tabular-nums">{{ team.memberCount }}</Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="team.isActive ? 'success' : 'secondary'">
                    {{ team.isActive ? 'Active' : 'Inactive' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="outline" :aria-label="`Members of ${team.name}`" @click="openMembers(team)">
                      <UsersRoundIcon />
                      Members
                    </Button>
                    <Button size="sm" variant="outline" :aria-label="`Edit ${team.name}`" @click="openEdit(team)">
                      <PencilIcon />
                      Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && teams.length === 0">
                <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                  No teams yet. Teams are optional — departments alone route work fine.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Teams are per property.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="team-name">Name</Label>
            <Input id="team-name" v-model="formName" placeholder="e.g. HK Morning Shift" maxlength="100" />
          </div>

          <div class="space-y-2">
            <Label for="team-desc">Description</Label>
            <Input id="team-desc" v-model="formDescription" placeholder="What this team covers (optional)" maxlength="500" />
          </div>

          <div class="space-y-2">
            <Label>Department</Label>
            <Select :model-value="toSelectValue(formDepartmentId)" @update:model-value="value => formDepartmentId = fromSelectValue(value)">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Cross-department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="SELECT_EMPTY">Cross-department</SelectItem>
                <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <Label for="team-active" class="cursor-pointer">Active</Label>
            <Switch id="team-active" v-model="formActive" />
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

    <Dialog v-model:open="membersDialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Members of {{ membersTeam?.name }}</DialogTitle>
          <DialogDescription>Who is on this team. Anyone at the property can be added.</DialogDescription>
        </DialogHeader>

        <Alert v-if="membersError" variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{{ membersError }}</AlertDescription>
        </Alert>

        <p v-if="membersLoading" class="py-6 text-center text-sm text-muted-foreground">Loading members…</p>

        <div v-else class="space-y-4 py-2">
          <p v-if="currentMembers.length === 0" class="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
            No members yet.
          </p>
          <ul v-else class="space-y-2">
            <li
              v-for="member in currentMembers"
              :key="member.userId"
              class="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <span class="text-sm font-medium text-foreground">{{ member.name }}</span>
              <Button
                size="sm"
                variant="ghost"
                class="text-muted-foreground hover:text-destructive"
                :disabled="isMemberPending(member.userId)"
                :aria-busy="isMemberPending(member.userId)"
                :aria-label="`Remove ${member.name} from ${membersTeam?.name}`"
                @click="removeMember(member.userId)"
              >
                <UserRoundMinusIcon />
                {{ isMemberPending(member.userId) ? 'Removing…' : 'Remove' }}
              </Button>
            </li>
          </ul>

          <div class="flex items-end gap-2">
            <div class="min-w-0 flex-1 space-y-2">
              <Label>Add a member</Label>
              <Select v-model="addUserId">
                <SelectTrigger class="w-full" :aria-label="`Staff member to add to ${membersTeam?.name}`">
                  <SelectValue placeholder="Choose a staff member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="person in addableStaff" :key="person.userId" :value="person.userId">
                    {{ person.firstName }} {{ person.lastName }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button :disabled="!addUserId || isAddPending" :aria-busy="isAddPending" @click="addMember">
              {{ isAddPending ? 'Adding…' : 'Add' }}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="membersDialogOpen = false">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
