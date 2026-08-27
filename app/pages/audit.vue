<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ScrollTextIcon, SearchIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { relativeTime } from '~/utils/task-ui'

const api = useTasksApi()

interface AuditRow {
  id: string
  action: string
  target: string
  detail: string | null
  createDate: string
  actor: { firstName: string, lastName: string } | null
  tenant: { name: string } | null
}

const events = ref<AuditRow[]>([])
const nextCursor = ref<string | null>(null)
const totalCount = ref(0)
const filter = ref('')
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const res = await api.listAuditEvents({ action: filter.value.trim() || undefined, limit: 25 })
    events.value = res.data as unknown as AuditRow[]
    nextCursor.value = res.meta.nextCursor
    totalCount.value = res.meta.totalCount
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

async function loadMore() {
  if (!nextCursor.value || isLoadingMore.value) return
  isLoadingMore.value = true
  try {
    const res = await api.listAuditEvents({ action: filter.value.trim() || undefined, limit: 25, cursor: nextCursor.value })
    events.value = [...events.value, ...(res.data as unknown as AuditRow[])]
    nextCursor.value = res.meta.nextCursor
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoadingMore.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
function onFilter() {
  clearTimeout(timer)
  timer = setTimeout(load, 250)
}

/** Grants and revocations are the entries an auditor actually comes here for. */
function isSensitive(action: string) {
  return action.startsWith('group_grant.') || action.startsWith('partner.')
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Audit trail"
      description="Who changed what, and when."
      :icon="ScrollTextIcon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <div class="relative max-w-md">
      <SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input v-model="filter" placeholder="Filter by action, e.g. sla or group_grant" class="pl-9" @input="onFilter" />
    </div>

    <TableSkeleton v-if="isLoading && events.length === 0" :rows="8" :columns="4" />

    <EmptyState
      v-else-if="events.length === 0"
      :icon="ScrollTextIcon"
      title="Nothing recorded"
      :description="filter ? 'No events match that filter.' : 'Configuration changes will appear here as they happen.'"
    />

    <template v-else>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="event in events" :key="event.id">
                  <TableCell class="whitespace-nowrap text-muted-foreground">
                    {{ relativeTime(event.createDate) }}
                  </TableCell>
                  <TableCell>
                    <Badge :variant="isSensitive(event.action) ? 'destructive' : 'secondary'" class="font-mono text-[10px]">
                      {{ event.action }}
                    </Badge>
                  </TableCell>
                  <TableCell class="whitespace-nowrap text-foreground">
                    {{ event.actor ? `${event.actor.firstName} ${event.actor.lastName}` : 'System' }}
                  </TableCell>
                  <TableCell class="text-muted-foreground">
                    <span class="font-mono text-xs">{{ event.target }}</span>
                    <span v-if="event.detail" class="block text-xs">{{ event.detail }}</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Button v-if="nextCursor" variant="outline" :disabled="isLoadingMore" @click="loadMore">
        {{ isLoadingMore ? 'Loading…' : `Load more (${events.length} of ${totalCount})` }}
      </Button>
    </template>
  </div>
</template>
