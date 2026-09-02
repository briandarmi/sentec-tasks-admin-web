<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { GaugeIcon } from '@lucide/vue'
import { useTasksApi, type GroupStats } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { statusMeta } from '~/utils/task-ui'

definePageMeta({ title: 'Group Report' })

/**
 * GET /v1/groups/{id}/stats — the cross-tenant surface. It admits a platform
 * operator, or an admin holding a grant on that specific group; everyone else
 * gets the same 403 whether or not the group exists. The group picker is fed
 * from the operator listing when available, else from the signed-in account's
 * own grants — a granted admin cannot enumerate groups they don't hold.
 */
const api = useTasksApi()
const session = useSession()

interface GroupOption { id: string, name: string }

const groupOptions = ref<GroupOption[]>([])
const selectedGroupId = ref('')
const report = ref<GroupStats | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')

const STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']

async function loadOptions() {
  try {
    // Operator path: the full platform listing.
    const groups = await api.listTenantGroups()
    groupOptions.value = groups.map(g => ({ id: g.id, name: g.name }))
  }
  catch {
    // Granted-admin path: only the groups on the account's own grants.
    groupOptions.value = (session.staff.value?.groupGrants ?? []).map(id => ({ id, name: `Group ${id.slice(0, 8).toUpperCase()}` }))
  }
  if (!selectedGroupId.value && groupOptions.value[0]) selectedGroupId.value = groupOptions.value[0].id
}

async function loadReport() {
  if (!selectedGroupId.value) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    report.value = await api.getGroupStats(selectedGroupId.value)
  }
  catch (e) {
    report.value = null
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

onMounted(async () => {
  await loadOptions()
  await loadReport()
})

const hasAccessToAny = computed(() => groupOptions.value.length > 0)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Group report"
      description="Task status and SLA breaches across every property in a brand group."
      :icon="GaugeIcon"
    />

    <EmptyState
      v-if="!hasAccessToAny"
      :icon="GaugeIcon"
      title="No group access"
      description="This account holds no group grant. Only a Sentinel Tech operator can grant one — a property admin cannot, including to themselves."
    />

    <template v-else>
      <div class="flex max-w-sm items-center gap-2">
        <Select v-model="selectedGroupId" @update:model-value="loadReport">
          <SelectTrigger class="w-full">
            <SelectValue placeholder="Pick a group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in groupOptions" :key="option.id" :value="option.id">{{ option.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertTitle>Could not load the report</AlertTitle>
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <TableSkeleton v-if="isLoading && !report" :rows="3" :columns="5" />

      <template v-else-if="report">
        <div class="grid grid-cols-3 gap-4">
          <div class="rounded-xl border bg-card p-5 shadow-sm">
            <p class="text-3xl font-bold tabular-nums text-foreground">{{ report.totals.openTotal }}</p>
            <p class="text-sm font-semibold text-foreground">Open across the group</p>
          </div>
          <div class="rounded-xl border bg-card p-5 shadow-sm">
            <p class="text-3xl font-bold tabular-nums" :class="report.totals.responseBreached ? 'text-destructive' : 'text-foreground'">{{ report.totals.responseBreached }}</p>
            <p class="text-sm font-semibold text-foreground">Response breaches</p>
          </div>
          <div class="rounded-xl border bg-card p-5 shadow-sm">
            <p class="text-3xl font-bold tabular-nums" :class="report.totals.resolutionBreached ? 'text-destructive' : 'text-foreground'">{{ report.totals.resolutionBreached }}</p>
            <p class="text-sm font-semibold text-foreground">Resolution breaches</p>
          </div>
        </div>

        <Card class="overflow-hidden rounded-xl pt-0">
          <CardContent class="p-0">
            <div class="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead v-for="status in STATUSES" :key="status" class="text-right">{{ statusMeta(status).label }}</TableHead>
                    <TableHead class="text-right">Open</TableHead>
                    <TableHead class="text-right">Breached</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="tenant in report.tenants" :key="tenant.hotelRef">
                    <TableCell class="font-medium text-foreground">{{ tenant.name }}</TableCell>
                    <TableCell v-for="status in STATUSES" :key="status" class="text-right tabular-nums text-foreground">
                      {{ tenant.byStatus[status] ?? 0 }}
                    </TableCell>
                    <TableCell class="text-right font-semibold tabular-nums text-foreground">{{ tenant.openTotal }}</TableCell>
                    <TableCell class="text-right tabular-nums" :class="tenant.responseBreached + tenant.resolutionBreached ? 'text-destructive' : 'text-muted-foreground'">
                      {{ tenant.responseBreached + tenant.resolutionBreached }}
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="report.tenants.length === 0">
                    <TableCell :colspan="STATUSES.length + 3" class="py-10 text-center text-sm text-muted-foreground">
                      This group has no member properties yet.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </template>
    </template>
  </div>
</template>
