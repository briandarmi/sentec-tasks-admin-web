<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2Icon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { HotelDepartment, MasterDepartment } from '~/utils/clientFakeApi'

/**
 * Departments are a two-level model in the real API: Sentinel curates a MASTER
 * catalogue (service-created, so reporting stays comparable across the group),
 * and each hotel ENABLES entries from it. An admin can read the catalogue and
 * enable — never invent a department name of their own.
 */
const api = useTasksApi()

const master = ref<MasterDepartment[]>([])
const enabled = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')

const enabledIds = computed(() => new Set(enabled.value.map(d => d.departmentId)))
const available = computed(() => master.value.filter(d => d.isActive && !enabledIds.value.has(d.id)))

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

const session = useSession()

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

    <TableSkeleton v-if="isLoading && enabled.length === 0" :rows="4" :columns="2" />

    <template v-else>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enabled at this property</TableHead>
                <TableHead class="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="dept in enabled" :key="dept.id">
                <TableCell class="font-medium text-foreground">{{ dept.departmentName }}</TableCell>
                <TableCell>
                  <Badge :variant="dept.isActive ? 'success' : 'secondary'">{{ dept.isActive ? 'Active' : 'Inactive' }}</Badge>
                </TableCell>
              </TableRow>
              <TableRow v-if="enabled.length === 0">
                <TableCell colspan="2" class="py-10 text-center text-sm text-muted-foreground">
                  Nothing enabled yet — tasks will route with no department until one is.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card class="rounded-xl">
        <CardHeader class="pb-2">
          <CardTitle class="text-base font-semibold">Master catalogue</CardTitle>
          <CardDescription>
            Curated by Sentinel Tech so reporting stays comparable across every property —
            a new master department is added by the platform, not here.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-1.5">
          <div
            v-for="dept in available"
            :key="dept.id"
            class="flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2"
          >
            <span class="text-sm font-medium text-foreground">{{ dept.name }}</span>
            <Button size="sm" variant="outline" :disabled="isSaving" @click="enable(dept.id)">
              <PlusIcon class="h-4 w-4" /> Enable here
            </Button>
          </div>
          <p v-if="available.length === 0" class="px-1 py-2 text-sm text-muted-foreground">
            Every master department is already enabled at this property.
          </p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
