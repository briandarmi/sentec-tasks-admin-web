<script setup lang="ts">
import { computed } from 'vue'
import {
  Building2Icon,
  CalendarClockIcon,
  GaugeIcon,
  HotelIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MapPinIcon,
  MapPinnedIcon,
  NetworkIcon,
  PlugZapIcon,
  RepeatIcon,
  ShapesIcon,
  SquareKanbanIcon,
  TimerIcon,
  UsersIcon,
  UsersRoundIcon,
  UtensilsCrossedIcon,
} from '@lucide/vue'
import { useCaps } from '~/composables/useCaps'
import { useSession } from '~/composables/useSession'
import { useConsoleAccess } from '~/composables/useConsoleAccess'

/**
 * The only shell in this app: sidebar navigation, wide content. Same structure
 * as the Butler admin console so an admin moving between the two products is not
 * relearning the furniture.
 *
 * Routes are flat — this app *is* the admin surface, so an /admin prefix would
 * only repeat the hostname. The admin/operator boundary therefore lives in
 * `middleware/auth.global.ts` and in each group's `visible` flag below, not in
 * the URL.
 */
const route = useRoute()
const session = useSession()
const caps = useCaps()
const access = useConsoleAccess()

interface NavItem { to: string, label: string, icon: unknown }
interface NavGroup { label: string, items: NavItem[], visible: boolean }

// The property screens are grouped Work / Organisation / Rules — what staff
// see, who does it, and how it is targeted — so fourteen entries stay scannable.
// Every property screen is admin AT THE SELECTED HOTEL (roles are per
// property), so the whole group follows `canConfigureProperty` and the page
// slot below is re-keyed on the hotel: a switch reloads the screen.
const navGroups = computed<NavGroup[]>(() => [
  {
    label: 'Work',
    visible: caps.canConfigureProperty.value,
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboardIcon },
      { to: '/board', label: 'Board Columns', icon: SquareKanbanIcon },
      { to: '/catalog', label: 'Catalog', icon: UtensilsCrossedIcon },
      { to: '/categories', label: 'Categories', icon: ShapesIcon },
    ],
  },
  {
    label: 'Organisation',
    visible: caps.canConfigureProperty.value,
    items: [
      { to: '/property', label: 'Property', icon: HotelIcon },
      { to: '/departments', label: 'Departments', icon: Building2Icon },
      // Roster import lives on the Staff screen.
      { to: '/staff', label: 'Staff', icon: UsersIcon },
      { to: '/teams', label: 'Teams', icon: UsersRoundIcon },
      { to: '/locations', label: 'Locations', icon: MapPinIcon },
    ],
  },
  {
    label: 'Rules',
    visible: caps.canConfigureProperty.value,
    items: [
      { to: '/routing', label: 'Routing Rules', icon: MapPinnedIcon },
      { to: '/slas', label: 'SLAs', icon: TimerIcon },
      { to: '/operating-schedules', label: 'Operating Schedules', icon: CalendarClockIcon },
      { to: '/task-templates', label: 'Task Templates', icon: RepeatIcon },
      { to: '/terminology', label: 'Terminology', icon: LanguagesIcon },
    ],
  },
  {
    label: 'Reporting',
    // Group stats admit granted admins and operators; the page handles denial.
    visible: true,
    items: [
      { to: '/group-report', label: 'Group Report', icon: GaugeIcon },
    ],
  },
  {
    label: 'Platform',
    visible: caps.canProvision.value,
    items: [
      { to: '/platform', label: 'Operator Home', icon: LayoutDashboardIcon },
      { to: '/properties', label: 'Properties', icon: Building2Icon },
      { to: '/groups', label: 'Groups & Access', icon: NetworkIcon },
      { to: '/partners', label: 'Integration Partners', icon: PlugZapIcon },
    ],
  },
])

const visibleGroups = computed(() => navGroups.value.filter(group => group.visible))

const activePath = computed(() => route.path)
// Every route is flat and childless, so an exact match is the whole rule. A
// prefix match would also mislight '/groups' from '/group-report' one day.
function isActive(to: string) {
  return activePath.value === to
}

/**
 * Only hotels this account administers — the account's own claim. An operator
 * has none, so the switcher disappears for them entirely.
 */
const properties = computed(() => access.adminHotels.value.map(id => session.hotels.value.find(hotel => hotel.id === id) ?? { id, name: id }))
const selectedTenantId = computed({
  get: () => session.hotelId.value ?? '',
  set: (value: string) => session.setHotelId(value),
})

const pageKey = computed(() => `${route.fullPath}:${session.hotelId.value ?? 'none'}`)
const accountName = computed(() => session.displayName.value || 'Signed in')
const accountInitials = computed(() =>
  accountName.value.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase(),
)

async function logout() {
  await session.logout()
  await navigateTo('/login')
}
</script>

<template>
  <SidebarProvider>
    <Sidebar variant="inset" collapsible="icon" class="whitespace-nowrap">
      <SidebarHeader>
        <div class="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:px-0">
          <AppLogo class="h-9 w-9 shrink-0 text-primary group-data-[collapsible=icon]:hidden" />
          <div class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <h1 class="truncate text-base font-bold leading-tight tracking-tight">Sentec Tasks</h1>
            <p class="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {{ caps.isOperator.value ? 'Platform' : 'Admin' }}
            </p>
          </div>
          <SidebarTrigger class="text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:mx-auto" />
        </div>

        <div v-if="properties.length" class="px-2 pt-1 group-data-[collapsible=icon]:hidden">
          <p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Active Property</p>
          <Select v-model="selectedTenantId">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Select property" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="property in properties" :key="property.id" :value="property.id">
                {{ property.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SidebarHeader>

      <SidebarContent class="gap-1 overflow-x-hidden">
        <template v-for="(group, groupIndex) in visibleGroups" :key="group.label">
          <!-- Collapsed to the icon rail the group labels are hidden, so a
               divider stands in for the boundary; expanded, the label does. -->
          <SidebarSeparator v-if="groupIndex > 0" class="my-1.5 hidden group-data-[collapsible=icon]:block" />
          <SidebarGroup class="py-0.5">
            <SidebarGroupLabel class="h-6 whitespace-nowrap group-data-[collapsible=icon]:hidden">{{ group.label }}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu class="gap-0.5 group-data-[collapsible=icon]:gap-1.5">
                <SidebarMenuItem v-for="item in group.items" :key="item.to">
                  <SidebarMenuButton as-child size="sm" :is-active="isActive(item.to)" :tooltip="item.label">
                    <NuxtLink :to="item.to">
                      <component :is="item.icon" />
                      <span>{{ item.label }}</span>
                    </NuxtLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </template>
      </SidebarContent>

      <SidebarFooter>
        <div class="flex items-center gap-2 rounded-xl bg-sidebar-accent/60 px-2.5 py-2 group-data-[collapsible=icon]:hidden">
          <Avatar class="h-8 w-8 shrink-0">
            <AvatarFallback class="bg-foreground text-xs font-bold text-background">{{ accountInitials }}</AvatarFallback>
          </Avatar>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">{{ accountName }}</p>
            <p class="text-xs font-medium text-muted-foreground">{{ caps.roleLabel.value }}</p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            title="Sign out"
            aria-label="Sign out"
            @click="logout"
          >
            <LogOutIcon class="h-4 w-4" />
          </Button>
        </div>

        <div class="hidden flex-col items-center gap-1 group-data-[collapsible=icon]:flex">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            class="text-muted-foreground hover:text-foreground"
            title="Sign out"
            aria-label="Sign out"
            @click="logout"
          >
            <LogOutIcon class="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="min-w-0">
      <!-- On small screens the sidebar is an off-screen drawer, so this bar is
           the only way to open it. Hidden from md up, where the rail is present. -->
      <header class="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur md:hidden">
        <SidebarTrigger class="-ml-1" />
        <div class="flex items-center gap-2">
          <AppLogo class="h-7 w-7 shrink-0 text-primary" />
          <span class="text-sm font-bold tracking-tight">Sentec Tasks</span>
        </div>
      </header>

      <div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div class="flex min-h-full min-w-0 flex-col p-4 md:p-8">
          <NuxtPage :key="pageKey" />
        </div>
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
