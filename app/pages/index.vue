<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HandIcon,
  LayoutDashboardIcon,
  RefreshCwIcon,
} from '@lucide/vue'
import { useTasksApi, type PropertySummary } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import { statusMeta } from '~/utils/task-ui'
import type { TaskStatus } from '~/utils/clientFakeApi'

const api = useTasksApi()
const session = useSession()

const summary = ref<PropertySummary | null>(null)
const isLoading = ref(false)
const errorMessage = ref('')

/** Largest status count, so the bars below are relative to the busiest one. */
const peak = computed(() => Math.max(1, ...(summary.value?.byStatus ?? []).map(s => s.count)))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    summary.value = await api.getSummary()
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Property overview"
      :description="session.activeTenant.value?.name ?? 'Current property'"
      :icon="LayoutDashboardIcon"
    >
      <template #actions>
        <Button size="sm" variant="outline" :disabled="isLoading" @click="load">
          <RefreshCwIcon class="h-4 w-4" :class="isLoading ? 'animate-spin' : ''" />
          Refresh
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div v-if="isLoading && !summary" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton v-for="n in 4" :key="n" class="h-28 rounded-xl" />
    </div>

    <template v-else-if="summary">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open" :value="summary.open" :icon="LayoutDashboardIcon" hint="Needs someone" />
        <StatCard label="To claim" :value="summary.unclaimed" :icon="HandIcon" hint="Nobody assigned" />
        <StatCard label="SLA breached" :value="summary.breached" :icon="AlertTriangleIcon" hint="Missed a target" />
        <StatCard label="Closed" :value="summary.finishedToday" :icon="CheckCircle2Icon" hint="Finished or verified" />
      </div>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card class="rounded-xl">
          <CardHeader>
            <CardTitle class="text-base font-semibold">By status</CardTitle>
            <CardDescription>Every task at this property.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <div v-for="row in summary.byStatus" :key="row.status" class="space-y-1">
              <div class="flex items-center justify-between gap-2 text-sm">
                <span class="flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full" :class="statusMeta(row.status as TaskStatus).dot" />
                  {{ statusMeta(row.status as TaskStatus).label }}
                </span>
                <span class="font-semibold tabular-nums">{{ row.count }}</span>
              </div>
              <!-- Bars are scaled to the busiest status rather than the total,
                   so a long tail of ones stays visible instead of collapsing. -->
              <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary/60" :style="{ width: `${(row.count / peak) * 100}%` }" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="rounded-xl">
          <CardHeader>
            <CardTitle class="text-base font-semibold">Open work by department</CardTitle>
            <CardDescription>Where the queue is sitting right now.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              v-if="summary.byDepartment.length === 0"
              bare
              title="No departments yet"
              description="Add departments so routing rules have somewhere to send work."
            />
            <div v-else class="divide-y divide-border">
              <div
                v-for="dept in summary.byDepartment"
                :key="dept.departmentId"
                class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <span class="truncate text-sm font-medium">{{ dept.name }}</span>
                <Badge :variant="dept.open > 0 ? 'secondary' : 'outline'" class="tabular-nums">{{ dept.open }} open</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
