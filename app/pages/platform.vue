<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Building2Icon,
  NetworkIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ShieldIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { relativeTime } from '~/utils/task-ui'

const api = useTasksApi()

const properties = ref<Awaited<ReturnType<typeof api.listTenants>>>([])
const groups = ref<Awaited<ReturnType<typeof api.listOperatorGroups>>>([])
const partners = ref<Awaited<ReturnType<typeof api.listPartners>>>([])
const grants = ref<Awaited<ReturnType<typeof api.listGroupGrants>>>([])
const isLoading = ref(false)
const errorMessage = ref('')

const liveGrants = computed(() => grants.value.filter(grant => !grant.revokedAt))
const openTasks = computed(() => properties.value.reduce((total, p) => total + p.openTaskCount, 0))

/**
 * Undelivered status events mean a partner is not hearing about task progress —
 * the guest-facing symptom is a request that looks stuck. Surfaced first
 * because nothing else on this page is as time-sensitive.
 */
const stuckPartners = computed(() => partners.value.filter(p => p.undeliveredEventCount > 0))

/** Grant rows carry the user as an opaque join, so name it in one place. */
function personName(value: unknown) {
  const person = value as { firstName?: string, lastName?: string } | null
  return person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : 'Unknown'
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedProperties, loadedGroups, loadedPartners, loadedGrants] = await Promise.all([
      api.listTenants(),
      api.listOperatorGroups(),
      api.listPartners(),
      api.listGroupGrants(),
    ])
    properties.value = loadedProperties
    groups.value = loadedGroups
    partners.value = loadedPartners
    grants.value = loadedGrants
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
      title="Platform"
      description="Sentinel Tech operations across every property on Sentec Tasks."
      :icon="ShieldIcon"
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

    <Alert v-if="stuckPartners.length" variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Status events aren't reaching {{ stuckPartners.length === 1 ? 'a partner' : 'some partners' }}</AlertTitle>
      <AlertDescription>
        {{ stuckPartners.map(p => `${p.name} (${p.undeliveredEventCount})`).join(', ') }} —
        requests raised there will look stuck to whoever is waiting on them.
      </AlertDescription>
    </Alert>

    <div v-if="isLoading && !properties.length" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton v-for="n in 4" :key="n" class="h-28 rounded-xl" />
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Properties" :value="properties.length" :icon="Building2Icon" :hint="`${openTasks} open tasks`" />
        <StatCard label="Groups" :value="groups.length" :icon="NetworkIcon" hint="Brand portfolios" />
        <StatCard label="Partners" :value="partners.length" :icon="PlugZapIcon" :hint="`${partners.filter(p => p.isActive).length} active`" />
        <StatCard label="Group grants" :value="liveGrants.length" :icon="ShieldIcon" hint="Live cross-property access" />
      </div>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card class="rounded-xl">
          <CardHeader>
            <CardTitle class="text-base font-semibold">Busiest properties</CardTitle>
            <CardDescription>By open task count.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="divide-y divide-border">
              <div
                v-for="property in [...properties].sort((a, b) => b.openTaskCount - a.openTaskCount).slice(0, 6)"
                :key="property.id"
                class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">{{ property.name }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ property.tenantGroup?.name ?? 'No group' }} · {{ property.staffCount }} staff
                  </p>
                </div>
                <Badge :variant="property.openTaskCount > 0 ? 'secondary' : 'outline'" class="shrink-0 tabular-nums">
                  {{ property.openTaskCount }} open
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card class="rounded-xl">
          <CardHeader>
            <CardTitle class="text-base font-semibold">Live group grants</CardTitle>
            <CardDescription>Read and write access across a whole brand.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState v-if="liveGrants.length === 0" bare title="No live grants" description="Nobody currently holds cross-property access." />
            <div v-else class="divide-y divide-border">
              <div v-for="grant in liveGrants" :key="grant.id" class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-foreground">{{ personName(grant.user) }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ grant.tenantGroup?.name }} · {{ grant.propertyCount }} properties · granted {{ relativeTime(grant.grantedAt) }}
                  </p>
                </div>
                <NuxtLink to="/groups" class="shrink-0 text-xs font-semibold text-primary underline-offset-2 hover:underline">
                  Manage
                </NuxtLink>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
