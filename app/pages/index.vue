<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LayoutDashboardIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { TaskStatus } from '~/utils/clientFakeApi'
import { statusMeta } from '~/utils/task-ui'

definePageMeta({ title: 'Overview' })

/**
 * The property overview. The real API has no summary endpoint — the numbers
 * here are the task list's own meta.total under each filter, fetched with
 * limit=1 so no rows travel. One filter per count keeps every figure exactly
 * what the list screens would show for the same filter.
 */
const api = useTasksApi()

const STATUSES: TaskStatus[] = ['NEW', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'FINISHED', 'VERIFIED', 'CANCELLED']

const byStatus = ref<Record<string, number>>({})
const total = ref(0)
const responseBreached = ref(0)
const resolutionBreached = ref(0)
const isLoading = ref(false)
const errorMessage = ref('')

async function countWhere(query: Record<string, string>): Promise<number> {
  const res = await api.listTasks({ ...query, limit: 1 } as never)
  return res.meta.total
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [allCount, respBreach, resolBreach, ...statusCounts] = await Promise.all([
      countWhere({}),
      countWhere({ responseSlaStatus: 'BREACHED' }),
      countWhere({ resolutionSlaStatus: 'BREACHED' }),
      ...STATUSES.map(status => countWhere({ status })),
    ])
    total.value = allCount
    responseBreached.value = respBreach
    resolutionBreached.value = resolBreach
    byStatus.value = Object.fromEntries(STATUSES.map((status, index) => [status, statusCounts[index] ?? 0]))
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

const openTotal = computed(() =>
  STATUSES.filter(s => !['FINISHED', 'VERIFIED', 'CANCELLED'].includes(s))
    .reduce((sum, s) => sum + (byStatus.value[s] ?? 0), 0))

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Overview"
      description="Where this property's work stands right now."
      :icon="LayoutDashboardIcon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border bg-card p-5 shadow-sm">
        <p class="text-3xl font-bold tabular-nums text-foreground">{{ isLoading ? '—' : openTotal }}</p>
        <p class="text-sm font-semibold text-foreground">Open tasks</p>
        <p class="text-xs text-muted-foreground">Everything not finished, verified or cancelled</p>
      </div>
      <div class="rounded-xl border bg-card p-5 shadow-sm">
        <p class="text-3xl font-bold tabular-nums text-foreground">{{ isLoading ? '—' : total }}</p>
        <p class="text-sm font-semibold text-foreground">All tasks</p>
        <p class="text-xs text-muted-foreground">Every task at this property</p>
      </div>
      <div class="rounded-xl border bg-card p-5 shadow-sm">
        <p class="text-3xl font-bold tabular-nums" :class="responseBreached ? 'text-destructive' : 'text-foreground'">{{ isLoading ? '—' : responseBreached }}</p>
        <p class="text-sm font-semibold text-foreground">Response breaches</p>
        <p class="text-xs text-muted-foreground">Picked up later than the SLA promised</p>
      </div>
      <div class="rounded-xl border bg-card p-5 shadow-sm">
        <p class="text-3xl font-bold tabular-nums" :class="resolutionBreached ? 'text-destructive' : 'text-foreground'">{{ isLoading ? '—' : resolutionBreached }}</p>
        <p class="text-sm font-semibold text-foreground">Resolution breaches</p>
        <p class="text-xs text-muted-foreground">Submitted or finished past the promise</p>
      </div>
    </div>

    <Card class="rounded-xl">
      <CardHeader class="pb-2">
        <CardTitle class="text-base font-semibold">By status</CardTitle>
        <CardDescription>The board's columns, as numbers.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <div v-for="status in STATUSES" :key="status" class="rounded-lg border bg-card px-3 py-2.5">
            <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <span class="h-2 w-2 rounded-full" :class="statusMeta(status).dot" />
              {{ statusMeta(status).label }}
            </span>
            <p class="mt-1 text-xl font-bold tabular-nums text-foreground">{{ isLoading ? '—' : byStatus[status] ?? 0 }}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
