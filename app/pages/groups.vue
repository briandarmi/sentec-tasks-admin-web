<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NetworkIcon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Staff, Tenant, TenantGroup } from '~/utils/clientFakeApi'

/**
 * Tenant groups and cross-tenant grants. A grant (PUT /v1/staff/{id}/
 * group-grants/{groupId}) expands the grantee's hotels claim to EVERY hotel in
 * the group — read and write — at their next sign-in. High blast radius, which
 * is why the whole surface is operator-only and a tenant admin can never grant
 * one, including to themselves.
 *
 * There is no grant-listing endpoint: grants live on each Staff row
 * (staff.groupGrants), so the holder table below is assembled from the staff
 * lists of the groups' member hotels.
 */
const api = useTasksApi()

type GroupRow = TenantGroup & { tenants: Array<{ hotelRef: string, name: string }> }

const groups = ref<GroupRow[]>([])
const tenants = ref<Tenant[]>([])
const staffByHotel = ref<Map<string, Staff[]>>(new Map())
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const createOpen = ref(false)
const formGroupName = ref('')

const grantOpen = ref(false)
const formGrantGroupId = ref('')
const formGrantHotel = ref('')
const formGrantStaffId = ref('')

const membershipOpen = ref(false)
const formMemberGroupId = ref('')
const formMemberHotel = ref('')

const revokeTarget = ref<{ staffId: string, groupId: string, name: string, groupName: string } | null>(null)

/** Every staff row seen, deduplicated — the grant table's source. */
const allStaff = computed(() => {
  const byId = new Map<string, Staff>()
  for (const rows of staffByHotel.value.values()) {
    for (const member of rows) byId.set(member.id, member)
  }
  return [...byId.values()]
})

interface GrantRow { staffId: string, name: string, email: string, groupId: string, groupName: string }

const grantRows = computed<GrantRow[]>(() => {
  const groupName = new Map(groups.value.map(g => [g.id, g.name]))
  return allStaff.value.flatMap(member =>
    member.groupGrants.map(groupId => ({
      staffId: member.id,
      name: member.name,
      email: member.email,
      groupId,
      groupName: groupName.get(groupId) ?? groupId,
    })),
  )
})

const grantHotelStaff = computed(() => staffByHotel.value.get(formGrantHotel.value) ?? [])

const ungroupedTenants = computed(() => {
  const grouped = new Set(groups.value.flatMap(g => g.tenants.map(t => t.hotelRef)))
  return tenants.value.filter(t => !grouped.has(t.hotelRef))
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedGroups, loadedTenants] = await Promise.all([api.listTenantGroups(), api.listTenants()])
    groups.value = loadedGroups
    tenants.value = loadedTenants
    // Operators may resolve any hotel on GET /v1/staff; a failure costs one
    // hotel's rows, never the screen. The hotel is passed explicitly since
    // an operator has no ambient X-Hotel-Id at all.
    const session = useSession()
    const perHotel = await Promise.all(loadedTenants.map(async (tenant) => {
      const env = await session.request<Staff[]>('/v1/staff', { hotelId: tenant.hotelRef }).catch(() => ({ data: [] as Staff[] }))
      return [tenant.hotelRef, env.data ?? []] as const
    }))
    staffByHotel.value = new Map(perHotel)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

async function createGroup() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.createTenantGroup(formGroupName.value.trim())
    createOpen.value = false
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function addMembership() {
  if (isSaving.value || !formMemberGroupId.value || !formMemberHotel.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.addTenantToGroup(formMemberGroupId.value, formMemberHotel.value)
    membershipOpen.value = false
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function grant() {
  if (isSaving.value || !formGrantGroupId.value || !formGrantStaffId.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.grantGroupAccess(formGrantStaffId.value, formGrantGroupId.value)
    grantOpen.value = false
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function confirmRevoke() {
  const target = revokeTarget.value
  if (!target || isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await api.revokeGroupAccess(target.staffId, target.groupId)
    revokeTarget.value = null
    await load()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
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
      title="Groups & Access"
      description="Brand groups, their member properties, and cross-property grants."
      :icon="NetworkIcon"
    >
      <template #actions>
        <Button size="sm" variant="outline" @click="membershipOpen = true; formMemberGroupId = ''; formMemberHotel = ''; formError = ''">
          Add property to group
        </Button>
        <Button size="sm" @click="createOpen = true; formGroupName = ''; formError = ''">
          <PlusIcon />
          New group
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && groups.length === 0" :rows="3" :columns="2" />

    <template v-else>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Member properties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="group in groups" :key="group.id">
                <TableCell class="font-medium text-foreground">{{ group.name }}</TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-1.5">
                    <Badge v-for="member in group.tenants" :key="member.hotelRef" variant="outline">{{ member.name }}</Badge>
                    <span v-if="group.tenants.length === 0" class="text-sm text-muted-foreground">Empty</span>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="groups.length === 0">
                <TableCell colspan="2" class="py-10 text-center text-sm text-muted-foreground">No groups yet.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card class="overflow-hidden rounded-xl pt-0">
        <CardHeader class="px-6 pb-2 pt-6">
          <CardTitle class="text-base font-semibold">Group grants</CardTitle>
          <CardDescription>
            Read <span class="font-semibold">and write</span> across every property in the group,
            live at the holder's next sign-in. Operator-only — a property admin cannot grant one, including to themselves.
          </CardDescription>
        </CardHeader>
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Group</TableHead>
                <TableHead class="text-right">
                  <Button size="sm" variant="outline" @click="grantOpen = true; formGrantGroupId = ''; formGrantHotel = ''; formGrantStaffId = ''; formError = ''">
                    Grant access
                  </Button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in grantRows" :key="`${row.staffId}:${row.groupId}`">
                <TableCell>
                  <p class="font-medium text-foreground">{{ row.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ row.email }}</p>
                </TableCell>
                <TableCell class="text-foreground">{{ row.groupName }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    class="text-muted-foreground hover:text-destructive"
                    @click="revokeTarget = { staffId: row.staffId, groupId: row.groupId, name: row.name, groupName: row.groupName }"
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="grantRows.length === 0">
                <TableCell colspan="3" class="py-10 text-center text-sm text-muted-foreground">No live grants.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </template>

    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>A brand: Aston, Favehotels, Huxley…</DialogDescription>
        </DialogHeader>
        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not create</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <div class="space-y-2 py-2">
          <Label for="group-name">Name</Label>
          <Input id="group-name" v-model="formGroupName" placeholder="e.g. Kamuela Villas" maxlength="100" />
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="createOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formGroupName.trim()" @click="createGroup">
            {{ isSaving ? 'Creating…' : 'Create group' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="membershipOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add property to group</DialogTitle>
          <DialogDescription>Adding also MOVES: a property lives in at most one group.</DialogDescription>
        </DialogHeader>
        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label>Group</Label>
            <Select v-model="formMemberGroupId">
              <SelectTrigger class="w-full"><SelectValue placeholder="Pick a group" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label>Property</Label>
            <Select v-model="formMemberHotel">
              <SelectTrigger class="w-full"><SelectValue placeholder="Pick a property" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="tenant in tenants" :key="tenant.hotelRef" :value="tenant.hotelRef">
                  {{ tenant.name }}<template v-if="ungroupedTenants.every(t => t.hotelRef !== tenant.hotelRef)"> (moves group)</template>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="membershipOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formMemberGroupId || !formMemberHotel" @click="addMembership">
            {{ isSaving ? 'Saving…' : 'Add to group' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="grantOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant group access</DialogTitle>
          <DialogDescription>Pick the holder from one of their properties' staff lists.</DialogDescription>
        </DialogHeader>
        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not grant</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label>Group</Label>
            <Select v-model="formGrantGroupId">
              <SelectTrigger class="w-full"><SelectValue placeholder="Pick a group" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label>Property (to find the person)</Label>
            <Select v-model="formGrantHotel" @update:model-value="formGrantStaffId = ''">
              <SelectTrigger class="w-full"><SelectValue placeholder="Pick a property" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="tenant in tenants" :key="tenant.hotelRef" :value="tenant.hotelRef">{{ tenant.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="formGrantHotel" class="space-y-2">
            <Label>Staff member</Label>
            <Select v-model="formGrantStaffId">
              <SelectTrigger class="w-full"><SelectValue placeholder="Pick a person" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="member in grantHotelStaff" :key="member.id" :value="member.id">
                  <!-- Roles are per property: GET /v1/staff narrowed each row's
                       memberships to the picked hotel, so this is their role THERE. -->
                  {{ member.name }} · {{ member.memberships.find(x => x.hotelRef === formGrantHotel)?.role ?? 'staff' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="grantOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formGrantGroupId || !formGrantStaffId" @click="grant">
            {{ isSaving ? 'Granting…' : 'Grant access' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(revokeTarget)" @update:open="value => { if (!value) revokeTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {{ revokeTarget?.name }}'s access to {{ revokeTarget?.groupName }}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their hotels claim shrinks back at the next sign-in; sessions already open keep their current claim until then.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="isSaving"
            @click.prevent="confirmRevoke"
          >
            {{ isSaving ? 'Revoking…' : 'Revoke' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
