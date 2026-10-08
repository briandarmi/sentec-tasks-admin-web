<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MapPinIcon, PencilIcon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Location as PropertyLocation, LocationType } from '~/utils/clientFakeApi'

const api = useTasksApi()

const locationTypes = ref<LocationType[]>([])
const locations = ref<PropertyLocation[]>([])
const isLoading = ref(false)
const errorMessage = ref('')

// ── location types ────────────────────────────────────────────────────────────

const typeDialogOpen = ref(false)
const typeSaving = ref(false)
const typeFormError = ref('')
const typeEditId = ref<string | undefined>()
const typeName = ref('')
const typeCode = ref('')
const typeLinksRequester = ref(false)
const typeSort = ref('1')
const typeActive = ref(true)

const typeDialogTitle = computed(() => (typeEditId.value ? 'Edit location type' : 'New location type'))

function isValidSort(raw: string) {
  const text = String(raw).trim()
  if (!text) return false
  const value = Number(text)
  return Number.isInteger(value) && value >= 0
}

const canSaveType = computed(() =>
  !typeSaving.value && Boolean(typeName.value.trim()) && Boolean(typeCode.value.trim()) && isValidSort(typeSort.value),
)

// ── locations ─────────────────────────────────────────────────────────────────

const locDialogOpen = ref(false)
const locSaving = ref(false)
const locFormError = ref('')
const locEditId = ref<string | undefined>()
const locName = ref('')
const locCode = ref('')
const locTypeId = ref('')
const locActive = ref(true)

const locDialogTitle = computed(() => (locEditId.value ? 'Edit location' : 'New location'))
const canSaveLoc = computed(() =>
  !locSaving.value && Boolean(locName.value.trim()) && Boolean(locCode.value.trim()) && Boolean(locTypeId.value),
)

/**
 * Only active types are offered when creating: the server refuses a deactivated
 * reference, so an inactive option is a choice whose only outcome is a failed
 * save. Display below still resolves against the FULL list, so an existing
 * location on a deactivated type keeps showing that type's real name.
 */
const activeTypes = computed(() => locationTypes.value.filter(type => type.isActive))

const typeNameById = computed(() => new Map(locationTypes.value.map(type => [type.id, type.name])))

function typeLabel(id: string) {
  return typeNameById.value.get(id) ?? 'Unknown type'
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedTypes, loadedLocations] = await Promise.all([
      api.listLocationTypes(),
      api.listLocations(),
    ])
    locationTypes.value = loadedTypes
    locations.value = loadedLocations
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreateType() {
  typeEditId.value = undefined
  typeName.value = ''
  typeCode.value = ''
  typeLinksRequester.value = false
  typeSort.value = String(locationTypes.value.length + 1)
  typeActive.value = true
  typeFormError.value = ''
  typeDialogOpen.value = true
}

function openEditType(type: LocationType) {
  typeEditId.value = type.id
  typeName.value = type.name
  typeCode.value = type.code
  typeLinksRequester.value = type.linksRequester
  typeSort.value = String(type.sort)
  typeActive.value = type.isActive
  typeFormError.value = ''
  typeDialogOpen.value = true
}

async function saveType() {
  if (typeSaving.value) return
  typeSaving.value = true
  typeFormError.value = ''
  try {
    await api.upsertLocationType({
      id: typeEditId.value,
      name: typeName.value,
      code: typeCode.value,
      linksRequester: typeLinksRequester.value,
      sort: Number(typeSort.value),
      isActive: typeActive.value,
    })
    await load()
    typeDialogOpen.value = false
  }
  catch (e) {
    typeFormError.value = (e as Error).message
  }
  finally {
    typeSaving.value = false
  }
}

function openCreateLoc() {
  locEditId.value = undefined
  locName.value = ''
  locCode.value = ''
  locTypeId.value = activeTypes.value[0]?.id ?? ''
  locActive.value = true
  locFormError.value = ''
  locDialogOpen.value = true
}

function openEditLoc(location: PropertyLocation) {
  locEditId.value = location.id
  locName.value = location.name
  locCode.value = location.code
  // Shown read-only in the dialog and echoed back on save: a location cannot
  // be moved to a different type after creation.
  locTypeId.value = location.locationTypeId
  locActive.value = location.isActive
  locFormError.value = ''
  locDialogOpen.value = true
}

async function saveLoc() {
  if (locSaving.value) return
  locSaving.value = true
  locFormError.value = ''
  try {
    await api.upsertLocation({
      id: locEditId.value,
      locationTypeId: locTypeId.value,
      name: locName.value,
      code: locCode.value,
      isActive: locActive.value,
    })
    await load()
    locDialogOpen.value = false
  }
  catch (e) {
    locFormError.value = (e as Error).message
  }
  finally {
    locSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Locations"
      description="Where work happens: the kinds of place this property has, and the places themselves."
      :icon="MapPinIcon"
    />

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="secondary" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && locationTypes.length === 0 && locations.length === 0" :rows="5" :columns="5" />

    <!-- Types before locations: a location must reference a type, so the tab
         order keeps that dependency visible. -->
    <Tabs v-else default-value="locations" class="space-y-4">
      <TabsList>
        <TabsTrigger value="locations">Locations</TabsTrigger>
        <TabsTrigger value="types">Location types</TabsTrigger>
      </TabsList>

      <TabsContent value="locations" class="space-y-4">
        <div class="flex justify-end">
          <Button size="sm" :disabled="!activeTypes.length" @click="openCreateLoc">
            <PlusIcon />
            New location
          </Button>
        </div>

        <Alert v-if="!isLoading && !activeTypes.length">
          <AlertTitle>Add a location type first</AlertTitle>
          <AlertDescription>Every location belongs to a type — create one on the “Location types” tab.</AlertDescription>
        </Alert>

        <Card class="overflow-hidden rounded-xl pt-0">
          <CardContent class="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="location in locations" :key="location.id" :class="location.isActive ? '' : 'opacity-55'">
                  <TableCell class="font-medium text-foreground">{{ location.name }}</TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">{{ location.code }}</TableCell>
                  <TableCell class="text-foreground">{{ typeLabel(location.locationTypeId) }}</TableCell>
                  <TableCell>
                    <Badge :variant="location.isActive ? 'success' : 'secondary'">
                      {{ location.isActive ? 'Active' : 'Inactive' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button size="sm" variant="secondary" :aria-label="`Edit ${location.name}`" @click="openEditLoc(location)">
                      <PencilIcon />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow v-if="!isLoading && locations.length === 0">
                  <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                    No locations yet.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="types" class="space-y-4">
        <div class="flex justify-end">
          <Button size="sm" @click="openCreateType">
            <PlusIcon />
            New location type
          </Button>
        </div>

        <Card class="overflow-hidden rounded-xl pt-0">
          <CardContent class="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Links requester</TableHead>
                  <TableHead class="w-16">Sort</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="type in locationTypes" :key="type.id" :class="type.isActive ? '' : 'opacity-55'">
                  <TableCell class="font-medium text-foreground">{{ type.name }}</TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground">{{ type.code }}</TableCell>
                  <TableCell>
                    <Badge :variant="type.linksRequester ? 'secondary' : 'outline'">
                      {{ type.linksRequester ? 'Yes' : 'No' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="tabular-nums text-muted-foreground">{{ type.sort }}</TableCell>
                  <TableCell>
                    <Badge :variant="type.isActive ? 'success' : 'secondary'">
                      {{ type.isActive ? 'Active' : 'Deactivated' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button size="sm" variant="secondary" :aria-label="`Edit ${type.name}`" @click="openEditType(type)">
                      <PencilIcon />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow v-if="!isLoading && locationTypes.length === 0">
                  <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                    No location types yet. Create one so locations have something to belong to.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>

    <Dialog v-model:open="typeDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ typeDialogTitle }}</DialogTitle>
          <DialogDescription>A kind of place work happens in: guest room, floor, public area…</DialogDescription>
        </DialogHeader>

        <Alert v-if="typeFormError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ typeFormError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="space-y-2 sm:col-span-2">
              <Label for="type-name">Name</Label>
              <Input id="type-name" v-model="typeName" placeholder="e.g. Guest Room" maxlength="100" />
            </div>
            <div class="space-y-2">
              <Label for="type-code">Code</Label>
              <Input id="type-code" v-model="typeCode" placeholder="RM" maxlength="50" class="uppercase" />
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="type-sort">Sort</Label>
              <Input id="type-sort" v-model="typeSort" type="number" min="0" step="1" />
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="type-requester" class="cursor-pointer">Links a requester</Label>
              <p class="text-xs text-muted-foreground">Tasks here carry who asked — rooms do, corridors don't.</p>
            </div>
            <Switch id="type-requester" v-model="typeLinksRequester" />
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="type-active" class="cursor-pointer">Active</Label>
              <!-- Existing locations keep a deactivated type; new ones can't pick it. -->
              <p class="text-xs text-muted-foreground">Deactivated types keep their locations but can't be chosen for new ones.</p>
            </div>
            <Switch id="type-active" v-model="typeActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="typeSaving" @click="typeDialogOpen = false">Cancel</Button>
          <Button :disabled="!canSaveType" @click="saveType">
            {{ typeSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="locDialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ locDialogTitle }}</DialogTitle>
          <DialogDescription>A concrete place at this property.</DialogDescription>
        </DialogHeader>

        <Alert v-if="locFormError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ locFormError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="space-y-2 sm:col-span-2">
              <Label for="loc-name">Name</Label>
              <Input id="loc-name" v-model="locName" placeholder="e.g. Room 1204" maxlength="100" />
            </div>
            <div class="space-y-2">
              <Label for="loc-code">Code</Label>
              <Input id="loc-code" v-model="locCode" placeholder="1204" maxlength="50" />
            </div>
          </div>

          <div class="space-y-2">
            <Label>Type</Label>
            <!-- Editing never offers a type change: the type is part of what the
                 location IS, and moving it would re-home its history. -->
            <div v-if="locEditId" class="flex min-h-9 items-center rounded-md border bg-muted/40 px-3">
              <Badge variant="secondary">{{ typeLabel(locTypeId) }}</Badge>
            </div>
            <Select v-else v-model="locTypeId">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Choose a location type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="type in activeTypes" :key="type.id" :value="type.id">{{ type.name }}</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              {{ locEditId ? 'A location keeps its type for life.' : 'Only active types are offered.' }}
            </p>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="loc-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Inactive locations keep their history but take no new work.</p>
            </div>
            <Switch id="loc-active" v-model="locActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="locSaving" @click="locDialogOpen = false">Cancel</Button>
          <Button :disabled="!canSaveLoc" @click="saveLoc">
            {{ locSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
