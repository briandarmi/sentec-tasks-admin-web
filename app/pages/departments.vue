<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2Icon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { HotelDepartment, MasterDepartment } from '~/utils/clientFakeApi'

/**
 * Departments are a two-level model in the real API: Sentinel curates a MASTER
 * catalogue (so reporting stays comparable across the group), and each hotel
 * ENABLES entries from it. An admin can read the catalogue and enable — never
 * invent a department name of their own.
 *
 * feat/department-crud: a hotel row has a soft delete (isActive false) and its
 * undo. Deactivating is refused (409) while a routing rule or an escalation
 * step still routes NEW work here; staff, teams and schedules keep an inactive
 * one. Reactivating is refused (422) once the platform has retired the master.
 */
const api = useTasksApi()
const session = useSession()

const master = ref<MasterDepartment[]>([])
const enabled = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')

const enabledIds = computed(() => new Set(enabled.value.map(d => d.departmentId)))
/** Not yet enabled here — retired masters included, shown but not enable-able. */
const available = computed(() => master.value.filter(d => !enabledIds.value.has(d.id)))

/** Deactivation is confirmed by name: it stops NEW routing here, and the API may refuse it. */
const deactivateTarget = ref<HotelDepartment | null>(null)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [masterRows, enabledRows] = await Promise.all([
      api.listMasterDepartments(),
      api.listHotelDepartments(),
    ])
    master.value = masterRows
    enabled.value = enabledRows
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

async function enable(departmentId: string) {
  if (isSaving.value || !session.hotelId.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await api.enableHotelDepartment(session.hotelId.value, departmentId)
    await load()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

async function setActive(dept: HotelDepartment, isActive: boolean) {
  if (isSaving.value) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await api.setHotelDepartmentActive(dept.id, isActive)
    deactivateTarget.value = null
    await load()
  }
  catch (e) {
    // The 409 names the routing-rule and escalation-step counts; the 422 says
    // the master is retired. Both are shown as the API worded them.
    errorMessage.value = (e as Error).message
    deactivateTarget.value = null
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
      description="Enable Sentinel's master departments for this property. Routing rules and staff point at the enabled ones."
      :icon="Building2Icon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && enabled.length === 0" :rows="4" :columns="5" />

    <template v-else>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enabled at this property</TableHead>
                  <TableHead class="w-28">Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="dept in enabled" :key="dept.id" :class="dept.isActive ? '' : 'opacity-55'">
                  <TableCell class="font-medium text-foreground">{{ dept.departmentName }}</TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">{{ dept.code ?? '—' }}</TableCell>
                  <TableCell class="max-w-72 truncate text-muted-foreground" :title="dept.description ?? ''">{{ dept.description ?? '—' }}</TableCell>
                  <TableCell>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <Badge :variant="dept.isActive ? 'success' : 'secondary'">{{ dept.isActive ? 'Active' : 'Inactive' }}</Badge>
                      <Badge v-if="!dept.masterIsActive" variant="warning">Retired by the platform</Badge>
                    </div>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button v-if="dept.isActive" size="sm" variant="outline" :disabled="isSaving" @click="deactivateTarget = dept">
                      Deactivate
                    </Button>
                    <!-- A retired master cannot come back at any hotel; the button says why rather than failing. -->
                    <div v-else class="inline-flex flex-col items-end gap-0.5">
                      <Button size="sm" variant="outline" :disabled="isSaving || !dept.masterIsActive" :title="dept.masterIsActive ? '' : 'Retired by the platform'" @click="setActive(dept, true)">
                        Reactivate
                      </Button>
                      <span v-if="!dept.masterIsActive" class="text-[11px] text-muted-foreground">Retired by the platform</span>
                    </div>
                  </TableCell>
                </TableRow>
                <TableRow v-if="enabled.length === 0">
                  <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                    Nothing enabled yet — tasks will route with no department until one is.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card class="rounded-xl">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold">Master catalogue</CardTitle>
          <CardDescription>
            Curated by Sentinel Tech so reporting stays comparable across every property —
            a new master department is added by the platform, not here. A retired one cannot be newly enabled.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-1.5">
          <div
            v-for="dept in available"
            :key="dept.id"
            class="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
            :class="dept.isActive ? '' : 'opacity-55'"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium text-foreground">{{ dept.name }}</span>
                <span v-if="dept.code" class="font-mono text-[11px] text-muted-foreground">{{ dept.code }}</span>
                <Badge v-if="!dept.isActive" variant="secondary">Retired</Badge>
              </div>
              <p v-if="dept.description" class="truncate text-xs text-muted-foreground">{{ dept.description }}</p>
            </div>
            <Button size="sm" variant="outline" :disabled="isSaving || !dept.isActive" @click="enable(dept.id)">
              <PlusIcon class="h-4 w-4" /> Enable here
            </Button>
          </div>
          <p v-if="available.length === 0" class="px-1 py-2 text-sm text-muted-foreground">
            Every master department is already enabled at this property.
          </p>
        </CardContent>
      </Card>
    </template>

    <AlertDialog :open="Boolean(deactivateTarget)" @update:open="value => { if (!value) deactivateTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {{ deactivateTarget?.departmentName }}?</AlertDialogTitle>
          <AlertDialogDescription>
            Nothing new routes here afterwards. Staff, teams, schedules and tasks already pointing at it keep working and show it as inactive.
            If a routing rule or an escalation step still routes to it, the API refuses and names them — repoint those first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isSaving">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="isSaving" @click.prevent="deactivateTarget && setActive(deactivateTarget, false)">
            {{ isSaving ? 'Working…' : 'Deactivate' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
