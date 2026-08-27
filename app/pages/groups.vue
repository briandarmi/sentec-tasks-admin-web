<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NetworkIcon, PlusIcon, ShieldIcon, TriangleAlertIcon, XIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { relativeTime } from '~/utils/task-ui'

const api = useTasksApi()

const groups = ref<Awaited<ReturnType<typeof api.listOperatorGroups>>>([])
const grants = ref<Awaited<ReturnType<typeof api.listGroupGrants>>>([])
const users = ref<Awaited<ReturnType<typeof api.listOperatorUsers>>>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const groupDialogOpen = ref(false)
const grantDialogOpen = ref(false)
const revokeTarget = ref<{ id: string, name: string } | null>(null)
const formGroupName = ref('')
const formGrantGroupId = ref('')
const formGrantUserId = ref('')

const liveGrants = computed(() => grants.value.filter(grant => !grant.revokedAt))
const revokedGrants = computed(() => grants.value.filter(grant => grant.revokedAt))

function personName(value: unknown) {
  const person = value as { firstName?: string, lastName?: string } | null
  return person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : 'Unknown'
}

const grantPropertyCount = computed(() => {
  const group = groups.value.find(g => g.id === formGrantGroupId.value)
  return group?.propertyCount ?? 0
})

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedGroups, loadedGrants, loadedUsers] = await Promise.all([
      api.listOperatorGroups(),
      api.listGroupGrants(),
      api.listOperatorUsers(),
    ])
    groups.value = loadedGroups
    grants.value = loadedGrants
    users.value = loadedUsers
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openGroupDialog() {
  formGroupName.value = ''
  formError.value = ''
  groupDialogOpen.value = true
}

async function saveGroup() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.createTenantGroup({ name: formGroupName.value.trim() })
    await load()
    groupDialogOpen.value = false
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

function openGrantDialog() {
  formGrantGroupId.value = groups.value[0]?.id ?? ''
  formGrantUserId.value = ''
  formError.value = ''
  grantDialogOpen.value = true
}

async function saveGrant() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.grantGroupAccess({ tenantGroupId: formGrantGroupId.value, userId: formGrantUserId.value })
    await load()
    grantDialogOpen.value = false
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
    await api.revokeGroupAccess(target.id)
    await load()
    revokeTarget.value = null
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
      title="Groups & access"
      description="Brand portfolios, and who can work across all of their properties."
      :icon="NetworkIcon"
    >
      <template #actions>
        <Button size="sm" variant="outline" @click="openGroupDialog">
          <PlusIcon />
          New group
        </Button>
        <Button size="sm" :disabled="!groups.length" @click="openGrantDialog">
          <ShieldIcon />
          Grant access
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <!--
      Group grants are the highest-blast-radius thing in this product: read AND
      write over every property in a brand. Only operators can issue one, a
      property admin cannot grant one to themselves, and each change is audited.
    -->
    <Alert>
      <ShieldIcon />
      <AlertTitle>A group grant is read and write across every property in the group</AlertTitle>
      <AlertDescription>
        Only operators can give or take one away — a property admin cannot, including to themselves.
        Every grant and revocation is written to the audit trail.
      </AlertDescription>
    </Alert>

    <section class="space-y-3">
      <h2 class="text-sm font-bold uppercase tracking-widest text-muted-foreground">Groups</h2>
      <TableSkeleton v-if="isLoading && groups.length === 0" :rows="3" :columns="3" />
      <Card v-else class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead>Live grants</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="group in groups" :key="group.id">
                <TableCell class="font-medium text-foreground">{{ group.name }}</TableCell>
                <TableCell class="tabular-nums text-foreground">{{ group.propertyCount }}</TableCell>
                <TableCell>
                  <Badge :variant="group.grantCount > 0 ? 'secondary' : 'outline'" class="tabular-nums">{{ group.grantCount }}</Badge>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && groups.length === 0">
                <TableCell colspan="3" class="py-10 text-center text-sm text-muted-foreground">No groups yet.</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>

    <section class="space-y-3">
      <h2 class="text-sm font-bold uppercase tracking-widest text-muted-foreground">Live grants</h2>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Reach</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="grant in liveGrants" :key="grant.id">
                  <TableCell class="font-medium text-foreground">{{ personName(grant.user) }}</TableCell>
                  <TableCell class="text-foreground">{{ grant.tenantGroup?.name ?? '—' }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ grant.propertyCount }} properties</TableCell>
                  <TableCell class="whitespace-nowrap text-muted-foreground">
                    {{ relativeTime(grant.grantedAt) }}
                    <span class="block text-xs">by {{ personName(grant.grantedByUser) }}</span>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      class="text-destructive"
                      @click="revokeTarget = { id: grant.id, name: personName(grant.user) }"
                    >
                      <XIcon />
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow v-if="liveGrants.length === 0">
                  <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                    Nobody holds cross-property access right now.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>

    <section v-if="revokedGrants.length" class="space-y-3">
      <h2 class="text-sm font-bold uppercase tracking-widest text-muted-foreground">Revoked</h2>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Revoked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="grant in revokedGrants" :key="grant.id" class="opacity-70">
                <TableCell class="text-foreground">{{ personName(grant.user) }}</TableCell>
                <TableCell class="text-foreground">{{ grant.tenantGroup?.name ?? '—' }}</TableCell>
                <TableCell class="text-muted-foreground">{{ relativeTime(grant.revokedAt) }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>

    <Dialog v-model:open="groupDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Usually a brand, e.g. Aston or Favehotels.</DialogDescription>
        </DialogHeader>
        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not create</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>
        <div class="space-y-2 py-2">
          <Label for="group-name">Name</Label>
          <Input id="group-name" v-model="formGroupName" placeholder="e.g. Harper" />
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="groupDialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formGroupName.trim()" @click="saveGroup">
            {{ isSaving ? 'Creating…' : 'Create group' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="grantDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant group access</DialogTitle>
          <DialogDescription>Read and write across every property in the group.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not grant</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label>Group</Label>
            <Select v-model="formGrantGroupId">
              <SelectTrigger class="w-full"><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="group in groups" :key="group.id" :value="group.id">
                  {{ group.name }} ({{ group.propertyCount }} properties)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label>Person</Label>
            <Select v-model="formGrantUserId">
              <SelectTrigger class="w-full"><SelectValue placeholder="Select person" /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="user in users" :key="user.id" :value="user.id">
                  {{ user.displayName }} — {{ user.email }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- State the blast radius in plain numbers before the click, not
               after: this is the action that is hardest to notice going wrong. -->
          <Alert v-if="formGrantGroupId" variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>This grants write access to {{ grantPropertyCount }} {{ grantPropertyCount === 1 ? 'property' : 'properties' }}</AlertTitle>
            <AlertDescription>They will be able to see and change work at every one of them. Recorded in the audit trail.</AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="grantDialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formGrantGroupId || !formGrantUserId" @click="saveGrant">
            {{ isSaving ? 'Granting…' : 'Grant access' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(revokeTarget)" @update:open="value => { if (!value) revokeTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {{ revokeTarget?.name }}'s group access?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to every property in the group they don't work at directly. This is recorded in the audit trail.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Keep access</AlertDialogCancel>
          <AlertDialogAction :disabled="isSaving" @click="confirmRevoke">
            {{ isSaving ? 'Revoking…' : 'Revoke' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
