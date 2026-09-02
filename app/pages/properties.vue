<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2Icon, KeyRoundIcon, PlusIcon, UserRoundPlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Tenant, TenantGroup } from '~/utils/clientFakeApi'

/**
 * Platform tenants. Provisioning is idempotent and seeds the master-template
 * board plus a default SLA; a fresh tenant has no admin until the first-admin
 * step mints one — with a temporary password shown exactly once, relayed to
 * the hotel out-of-band (there is no mail transport in this system).
 */
const api = useTasksApi()

type GroupRow = TenantGroup & { tenants: Array<{ hotelRef: string, name: string }> }

const tenants = ref<Tenant[]>([])
const groups = ref<GroupRow[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const provisionOpen = ref(false)
const formHotelRef = ref('')
const formName = ref('')

const firstAdminOpen = ref(false)
const firstAdminTenant = ref<Tenant | null>(null)
const formAdminEmail = ref('')
const formAdminName = ref('')
/** The one-time temporary password — shown until dismissed, never again. */
const minted = ref<{ email: string, password: string } | null>(null)

const groupNameByHotel = computed(() => {
  const map = new Map<string, string>()
  for (const group of groups.value) {
    for (const member of group.tenants) map.set(member.hotelRef, group.name)
  }
  return map
})

function randomHotelRef(): string {
  // A convenience for the demo: real provisioning brings Butler's hotelRef.
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedTenants, loadedGroups] = await Promise.all([api.listTenants(), api.listTenantGroups()])
    tenants.value = loadedTenants
    groups.value = loadedGroups
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openProvision() {
  formHotelRef.value = randomHotelRef()
  formName.value = ''
  formError.value = ''
  provisionOpen.value = true
}

async function provision() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.provisionTenant({ hotelRef: formHotelRef.value.trim(), name: formName.value.trim() })
    provisionOpen.value = false
    await load()
  }
  catch (e) {
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

function openFirstAdmin(tenant: Tenant) {
  firstAdminTenant.value = tenant
  formAdminEmail.value = ''
  formAdminName.value = ''
  formError.value = ''
  firstAdminOpen.value = true
}

async function createFirstAdmin() {
  const tenant = firstAdminTenant.value
  if (!tenant || isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    const created = await api.createFirstAdmin(tenant.hotelRef, { email: formAdminEmail.value.trim(), name: formAdminName.value.trim() })
    firstAdminOpen.value = false
    minted.value = { email: created.email, password: created.temporaryPassword }
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
      title="Properties"
      description="Provisioned tenants. Each gets the template board, a default SLA, and its own task partitions."
      :icon="Building2Icon"
    >
      <template #actions>
        <Button size="sm" @click="openProvision">
          <PlusIcon />
          Provision property
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <!-- The one-time temporary password, mirroring the partner-secret pattern. -->
    <div v-if="minted" class="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div class="flex items-start gap-3">
        <KeyRoundIcon class="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div class="min-w-0 flex-1 space-y-2">
          <p class="text-sm font-bold text-foreground">Temporary password for {{ minted.email }}</p>
          <p class="text-xs text-muted-foreground">
            Shown once — only its hash is stored, and no route can recover it. Relay it to the hotel's admin
            out-of-band; rotating it afterwards is their job.
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs">{{ minted.password }}</code>
            <Button size="sm" variant="ghost" @click="minted = null">Done</Button>
          </div>
        </div>
      </div>
    </div>

    <TableSkeleton v-if="isLoading && tenants.length === 0" :rows="4" :columns="4" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Hotel ref</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="tenant in tenants" :key="tenant.hotelRef">
                <TableCell class="font-medium text-foreground">{{ tenant.name }}</TableCell>
                <TableCell class="text-foreground">{{ groupNameByHotel.get(tenant.hotelRef) ?? '—' }}</TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">{{ tenant.hotelRef }}</TableCell>
                <TableCell class="text-right">
                  <Button size="sm" variant="outline" @click="openFirstAdmin(tenant)">
                    <UserRoundPlusIcon />
                    First admin
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && tenants.length === 0">
                <TableCell colspan="4" class="py-10 text-center text-sm text-muted-foreground">
                  Nothing provisioned yet.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="provisionOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Provision property</DialogTitle>
          <DialogDescription>
            Idempotent: re-provisioning an existing hotelRef changes nothing. Seeds the standard board and a default SLA.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not provision</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="tenant-name">Name</Label>
            <Input id="tenant-name" v-model="formName" placeholder="e.g. Harper Cikarang" />
          </div>
          <div class="space-y-2">
            <Label for="tenant-ref">Hotel ref (UUID)</Label>
            <Input id="tenant-ref" v-model="formHotelRef" class="font-mono text-xs" />
            <p class="text-xs text-muted-foreground">In production this comes from Butler; a fresh one is pre-filled for the demo.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="provisionOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formName.trim() || !formHotelRef.trim()" @click="provision">
            {{ isSaving ? 'Provisioning…' : 'Provision' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="firstAdminOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>First admin for {{ firstAdminTenant?.name }}</DialogTitle>
          <DialogDescription>
            One per tenant: a second call is refused once any admin exists. Further admins are promoted
            from that hotel's own Staff screen.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not create the admin</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="admin-name">Name</Label>
            <Input id="admin-name" v-model="formAdminName" placeholder="Full name" />
          </div>
          <div class="space-y-2">
            <Label for="admin-email">Email</Label>
            <Input id="admin-email" v-model="formAdminEmail" type="email" placeholder="gm@property.example" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="firstAdminOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formAdminName.trim() || !formAdminEmail.includes('@')" @click="createFirstAdmin">
            {{ isSaving ? 'Creating…' : 'Create admin' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
