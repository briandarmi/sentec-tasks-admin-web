<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Building2Icon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'

const api = useTasksApi()

const properties = ref<Awaited<ReturnType<typeof api.listTenants>>>([])
const groups = ref<Awaited<ReturnType<typeof api.listOperatorGroups>>>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const formName = ref('')
const formCode = ref('')
const formGroupId = ref('')
const formTimezone = ref('Asia/Jakarta')

// Kept short and Indonesia-first: these are the zones the estate actually spans.
const TIMEZONES = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore']

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedProperties, loadedGroups] = await Promise.all([api.listTenants(), api.listOperatorGroups()])
    properties.value = loadedProperties
    groups.value = loadedGroups
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreate() {
  formName.value = ''
  formCode.value = ''
  formGroupId.value = ''
  formTimezone.value = 'Asia/Jakarta'
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.createTenant({
      name: formName.value.trim(),
      code: formCode.value.trim().toUpperCase(),
      tenantGroupId: formGroupId.value || null,
      timezone: formTimezone.value,
    })
    await load()
    dialogOpen.value = false
  }
  catch (e) {
    formError.value = (e as Error).message
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
      title="Properties"
      description="Every property on the platform. Onboarding is done by us, not self-serve."
      :icon="Building2Icon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New property
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && properties.length === 0" :rows="6" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Open tasks</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="property in properties" :key="property.id">
                <TableCell>
                  <p class="font-medium text-foreground">{{ property.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ property.timezone }}</p>
                </TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">{{ property.code }}</TableCell>
                <TableCell class="text-foreground">{{ property.tenantGroup?.name ?? '—' }}</TableCell>
                <TableCell class="tabular-nums text-foreground">{{ property.staffCount }}</TableCell>
                <TableCell class="tabular-nums text-foreground">{{ property.openTaskCount }}</TableCell>
                <TableCell>
                  <Badge :variant="property.isActive ? 'success' : 'secondary'">
                    {{ property.isActive ? 'Active' : 'Inactive' }}
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New property</DialogTitle>
          <DialogDescription>
            Creating a property also provisions its board and a default SLA, so it is usable straight away.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not create</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="prop-name">Name</Label>
            <Input id="prop-name" v-model="formName" placeholder="e.g. Harper Malioboro" />
          </div>

          <div class="space-y-2">
            <Label for="prop-code">Code</Label>
            <Input id="prop-code" v-model="formCode" placeholder="e.g. HRP-MLB" class="font-mono uppercase" />
            <!-- The code is the stable handle partners and reports use, so it
                 has to be unique and is awkward to change later. -->
            <p class="text-xs text-muted-foreground">Short, unique, and hard to change later — it identifies the property to partners.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Group</Label>
              <Select :model-value="toSelectValue(formGroupId)" @update:model-value="value => formGroupId = fromSelectValue(value)">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="No group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="SELECT_EMPTY">No group</SelectItem>
                  <SelectItem v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Timezone</Label>
              <Select v-model="formTimezone">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="zone in TIMEZONES" :key="zone" :value="zone">{{ zone }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formName.trim() || !formCode.trim()" @click="save">
            {{ isSaving ? 'Creating…' : 'Create property' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
