<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Building2Icon, LayoutDashboardIcon, NetworkIcon, PlugZapIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Partner, Tenant, TenantGroup } from '~/utils/clientFakeApi'

definePageMeta({ title: 'Operator Home' })

/**
 * The operator's landing screen. An operator's account carries NO hotel claim,
 * so nothing here is hotel-scoped — it is all the platform surface: tenants,
 * groups, partners, and the source-app registry.
 */
const api = useTasksApi()

type GroupRow = TenantGroup & { tenants: Array<{ hotelRef: string, name: string }> }

const tenants = ref<Tenant[]>([])
const groups = ref<GroupRow[]>([])
const partners = ref<Partner[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

const activePartners = computed(() => partners.value.filter(p => p.isActive).length)
const groupedTenants = computed(() => new Set(groups.value.flatMap(g => g.tenants.map(t => t.hotelRef))).size)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedTenants, loadedGroups, loadedPartners] = await Promise.all([
      api.listTenants(),
      api.listTenantGroups(),
      api.listPartners(),
    ])
    tenants.value = loadedTenants
    groups.value = loadedGroups
    partners.value = loadedPartners
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

onMounted(load)

const tiles = computed(() => [
  { label: 'Properties', value: tenants.value.length, hint: `${groupedTenants.value} in a group`, to: '/properties', icon: Building2Icon },
  { label: 'Groups', value: groups.value.length, hint: 'Brands with member properties', to: '/groups', icon: NetworkIcon },
  { label: 'Partners', value: partners.value.length, hint: `${activePartners.value} active`, to: '/partners', icon: PlugZapIcon },
])
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Operator home"
      description="The Sentinel Tech platform surface: tenants, groups, partners and the source-app registry."
      :icon="LayoutDashboardIcon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <NuxtLink
        v-for="tile in tiles"
        :key="tile.to"
        :to="tile.to"
        class="rounded-xl border bg-card p-5 shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <component :is="tile.icon" class="h-5 w-5 text-primary" />
        <p class="mt-3 text-3xl font-bold tabular-nums text-foreground">{{ isLoading ? '—' : tile.value }}</p>
        <p class="text-sm font-semibold text-foreground">{{ tile.label }}</p>
        <p class="text-xs text-muted-foreground">{{ tile.hint }}</p>
      </NuxtLink>
    </div>

    <Card class="rounded-xl">
      <CardHeader class="pb-2">
        <CardTitle class="text-base font-semibold">Why the property screens are empty for you</CardTitle>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground">
        An operator account carries no hotel claim, so every hotel-scoped route refuses it — by design.
        Property configuration belongs to that property's own admin, whose first account is minted from
        the Properties screen. Group-level reporting is the one shared surface:
        <NuxtLink to="/group-report" class="font-medium text-primary underline-offset-2 hover:underline">Group Report</NuxtLink>.
      </CardContent>
    </Card>
  </div>
</template>
