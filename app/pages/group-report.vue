<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { GaugeIcon, InfoIcon, RefreshCwIcon } from '@lucide/vue'
import { useTasksApi, type GroupReport } from '~/composables/useTasksApi'
import type { TenantGroup } from '~/utils/clientFakeApi'

const api = useTasksApi()

const groups = ref<TenantGroup[]>([])
const selectedGroupId = ref('')
const report = ref<GroupReport | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')

/** Scale the bars to the busiest property rather than the total. */
const peak = computed(() => Math.max(1, ...(report.value?.properties ?? []).map(p => p.open)))

async function loadGroups() {
  try {
    groups.value = await api.listTenantGroups()
    if (groups.value.length && !selectedGroupId.value) {
      selectedGroupId.value = groups.value[0]!.id
    }
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
}

async function loadReport() {
  if (!selectedGroupId.value) return
  isLoading.value = true
  errorMessage.value = ''
  try {
    report.value = await api.getGroupReport(selectedGroupId.value)
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    report.value = null
  }
  finally {
    isLoading.value = false
  }
}

watch(selectedGroupId, loadReport)

onMounted(async () => {
  await loadGroups()
  await loadReport()
})
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Group report"
      description="Open work across every property in a brand you can reach."
      :icon="GaugeIcon"
    >
      <template #actions>
        <Button size="sm" variant="outline" :disabled="isLoading || !selectedGroupId" @click="loadReport">
          <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
          Refresh
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <EmptyState
      v-if="!isLoading && groups.length === 0"
      :icon="GaugeIcon"
      title="No groups available"
      description="You can only report on a brand where you can reach at least one property."
    />

    <template v-else>
      <div class="max-w-sm space-y-2">
        <Label>Group</Label>
        <Select v-model="selectedGroupId">
          <SelectTrigger class="w-full"><SelectValue placeholder="Select group" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-if="isLoading && !report" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton v-for="n in 4" :key="n" class="h-28 rounded-xl" />
      </div>

      <template v-else-if="report">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total tasks" :value="report.totals.total" :icon="GaugeIcon" />
          <StatCard label="Open" :value="report.totals.open" :icon="GaugeIcon" />
          <StatCard label="To claim" :value="report.totals.unclaimed" :icon="GaugeIcon" />
          <StatCard label="SLA breached" :value="report.totals.breached" :icon="GaugeIcon" />
        </div>

        <!--
          The report is bounded to the properties the caller can actually reach,
          which means the totals are not the brand's totals when reach is
          partial. Saying so is the difference between a useful number and a
          misleading one.
        -->
        <Alert v-if="report.hiddenPropertyCount > 0">
          <InfoIcon />
          <AlertTitle>
            {{ report.hiddenPropertyCount }}
            {{ report.hiddenPropertyCount === 1 ? 'property is' : 'properties are' }} not included
          </AlertTitle>
          <AlertDescription>
            These figures cover only the properties you can access, so they are not the whole of {{ report.tenantGroupName }}.
            Cross-property reach comes from a group grant, which an operator issues.
          </AlertDescription>
        </Alert>

        <Card class="overflow-hidden rounded-xl pt-0">
          <CardContent class="p-0">
            <div class="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Open</TableHead>
                    <TableHead>To claim</TableHead>
                    <TableHead>Breached</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead class="w-40">Load</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in report.properties" :key="row.tenantId">
                    <TableCell class="font-medium text-foreground">{{ row.tenantName }}</TableCell>
                    <TableCell class="tabular-nums text-foreground">{{ row.open }}</TableCell>
                    <TableCell class="tabular-nums text-foreground">{{ row.unclaimed }}</TableCell>
                    <TableCell>
                      <Badge :variant="row.breached > 0 ? 'destructive' : 'outline'" class="tabular-nums">{{ row.breached }}</Badge>
                    </TableCell>
                    <TableCell class="tabular-nums text-muted-foreground">{{ row.total }}</TableCell>
                    <TableCell>
                      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div class="h-full rounded-full bg-primary/60" :style="{ width: `${(row.open / peak) * 100}%` }" />
                      </div>
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
