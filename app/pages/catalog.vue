<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, Trash2Icon, UtensilsCrossedIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Category, CatalogItem, TaskPriority } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES, formatMinutes, priorityMeta } from '~/utils/task-ui'

const api = useTasksApi()

const categories = ref<Category[]>([])
const items = ref<CatalogItem[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formDescription = ref('')
const formCategoryId = ref('')
const formQuantity = ref(false)
const formPriority = ref<TaskPriority>('NORMAL')
const formRequiresLocation = ref(false)
/** Held as a string so a cleared field is distinguishable from a typed 0. */
const formMinPhotos = ref('0')
const formRequiresNote = ref(false)
const formChecklist = ref<string[]>([])
/**
 * Round-trip only — no control edits it. The upsert is a full replace, so a
 * save that omitted this field would clear a duration some other producer
 * (task templates, the API) had written.
 */
const formDuration = ref<number | null>(null)
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit item' : 'New catalog item'))

/** Only active categories are offered — a deactivated one is a failed save. */
const activeCategories = computed(() => categories.value.filter(category => category.isActive))

/**
 * The edit dialog additionally offers the item's own category even when it has
 * been deactivated, marked as such. Without it the select would silently snap
 * to the first option — and then actually reassign the item on save.
 */
const categoryOptions = computed(() => {
  const options = activeCategories.value.map(category => ({ value: category.id, label: `${category.icon ?? ''} ${category.name}`.trim() }))
  const current = formCategoryId.value
  if (current && !options.some(option => option.value === current)) {
    const category = categories.value.find(c => c.id === current)
    if (category) options.push({ value: category.id, label: `${category.icon ?? ''} ${category.name} (deactivated)`.trim() })
  }
  return options
})

/**
 * Whole number, 0–10. A blank field is invalid rather than treated as 0, so a
 * cleared input cannot silently drop an item's proof gate.
 */
function isValidProofPhotos(raw: string) {
  const text = String(raw).trim()
  if (!text) return false
  const value = Number(text)
  return Number.isInteger(value) && value >= 0 && value <= 10
}

const proofPhotosInvalid = computed(() => !isValidProofPhotos(formMinPhotos.value))

const canSave = computed(() =>
  !isSaving.value && Boolean(formName.value.trim()) && Boolean(formCategoryId.value) && !proofPhotosInvalid.value,
)

/** Group by category, keeping empty categories out of the way. */
const groups = computed(() =>
  categories.value
    .map(category => ({ category, items: items.value.filter(item => item.categoryId === category.id) }))
    .filter(group => group.items.length > 0),
)

/** Compact proof-gate summary for the table. */
function proofLabel(item: CatalogItem) {
  const parts: string[] = []
  if (item.minProofPhotos > 0) parts.push(`${item.minProofPhotos} photo${item.minProofPhotos === 1 ? '' : 's'}`)
  if (item.requiresCompletionNote) parts.push('note')
  return parts.join(' + ')
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedCategories, loadedItems] = await Promise.all([
      api.listCategories(),
      api.listCatalogItems(),
    ])
    categories.value = loadedCategories
    items.value = loadedItems
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreate() {
  editId.value = undefined
  formName.value = ''
  formDescription.value = ''
  formCategoryId.value = activeCategories.value[0]?.id ?? ''
  formQuantity.value = false
  formPriority.value = 'NORMAL'
  formRequiresLocation.value = false
  formMinPhotos.value = '0'
  formRequiresNote.value = false
  formChecklist.value = []
  formDuration.value = null
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(item: CatalogItem) {
  editId.value = item.id
  formName.value = item.name
  formDescription.value = item.description ?? ''
  formCategoryId.value = item.categoryId ?? ''
  formQuantity.value = item.itemQuantity
  formPriority.value = item.defaultPriority
  formRequiresLocation.value = item.requiresLocation
  formMinPhotos.value = String(item.minProofPhotos)
  formRequiresNote.value = item.requiresCompletionNote
  // Copied, not aliased: the editor mutates the array in place.
  formChecklist.value = [...item.defaultChecklist]
  formDuration.value = item.defaultDurationMinutes
  formActive.value = item.isActive
  formError.value = ''
  dialogOpen.value = true
}

function addChecklistStep() {
  formChecklist.value.push('')
}

function removeChecklistStep(index: number) {
  formChecklist.value.splice(index, 1)
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertCatalogItem({
      id: editId.value,
      categoryId: formCategoryId.value,
      name: formName.value,
      description: formDescription.value.trim() || null,
      itemQuantity: formQuantity.value,
      defaultPriority: formPriority.value,
      requiresLocation: formRequiresLocation.value,
      // Blank steps are dropped, not saved: an empty label would seed a blank
      // checklist step onto every task raised from this item.
      defaultChecklist: formChecklist.value.map(step => step.trim()).filter(Boolean),
      defaultDurationMinutes: formDuration.value,
      minProofPhotos: Number(formMinPhotos.value),
      requiresCompletionNote: formRequiresNote.value,
      isActive: formActive.value,
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
      title="Catalog"
      description="The list of things people can ask for at this property."
      :icon="UtensilsCrossedIcon"
    >
      <template #actions>
        <Button size="sm" :disabled="!activeCategories.length" @click="openCreate">
          <PlusIcon />
          New item
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="outline" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <Card class="rounded-xl">
      <CardContent>
        <div class="flex items-start gap-3">
          <UtensilsCrossedIcon class="mt-0.5 shrink-0 text-primary" />
          <!-- The catalog being native is what lets Tasks stand alone: a
               property with no Butler still has something to raise work against. -->
          <p class="text-sm text-foreground">
            This catalog belongs to Sentec Tasks, not to any partner app — so staff can raise work here
            whether or not the property runs Butler. Items also drive
            <NuxtLink to="/routing" class="font-semibold text-primary underline-offset-2 hover:underline">routing rules</NuxtLink>,
            and are grouped by the
            <NuxtLink to="/categories" class="font-semibold text-primary underline-offset-2 hover:underline">categories</NuxtLink>
            this property defines.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && items.length === 0" :rows="6" :columns="6" />

    <EmptyState
      v-else-if="items.length === 0"
      :icon="UtensilsCrossedIcon"
      title="Nothing in the catalog yet"
      description="Add the requests this property handles, so staff can raise them in one tap."
    >
      <Button v-if="activeCategories.length" size="sm" @click="openCreate">
        <PlusIcon />
        New item
      </Button>
    </EmptyState>

    <section v-for="group in groups" v-else :key="group.category.id" class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        <span aria-hidden="true">{{ group.category.icon }}</span>
        {{ group.category.name }}
        <Badge v-if="!group.category.isActive" variant="secondary">Deactivated</Badge>
      </h2>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <div class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Proof to finish</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead class="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="item in group.items" :key="item.id" :class="item.isActive ? '' : 'opacity-55'">
                  <TableCell>
                    <p class="font-medium text-foreground">{{ item.name }}</p>
                    <p v-if="item.description" class="max-w-72 truncate text-xs text-muted-foreground">{{ item.description }}</p>
                    <p v-if="item.defaultDurationMinutes" class="text-xs text-muted-foreground">~{{ formatMinutes(item.defaultDurationMinutes) }}</p>
                  </TableCell>
                  <TableCell>
                    <span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold" :class="priorityMeta(item.defaultPriority).badge">
                      {{ priorityMeta(item.defaultPriority).label }}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge :variant="item.itemQuantity ? 'secondary' : 'outline'">
                      {{ item.itemQuantity ? 'Takes a number' : 'Single' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-foreground">
                    {{ proofLabel(item) || '—' }}
                  </TableCell>
                  <TableCell>
                    <Badge :variant="item.isActive ? 'success' : 'secondary'">
                      {{ item.isActive ? 'Active' : 'Hidden' }}
                    </Badge>
                  </TableCell>
                  <TableCell class="text-right">
                    <Button size="sm" variant="outline" :aria-label="`Edit ${item.name}`" @click="openEdit(item)">
                      <PencilIcon />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Catalog items are per property.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="item-name">Name</Label>
            <Input id="item-name" v-model="formName" placeholder="e.g. Extra pillows" />
          </div>

          <div class="space-y-2">
            <Label for="item-desc">Description</Label>
            <Textarea id="item-desc" v-model="formDescription" rows="2" placeholder="What staff should know before doing this (optional)" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Category</Label>
              <Select v-model="formCategoryId">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="option in categoryOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Default priority</Label>
              <Select v-model="formPriority">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="priority in TASK_PRIORITIES" :key="priority" :value="priority">
                    {{ priorityMeta(priority).label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p class="text-xs text-muted-foreground">Stamped on every task raised from this item.</p>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="item-qty" class="cursor-pointer">Takes a quantity</Label>
              <p class="text-xs text-muted-foreground">Shows a number field, e.g. “3 towels”.</p>
            </div>
            <Switch id="item-qty" v-model="formQuantity" />
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="item-loc" class="cursor-pointer">Requires a location</Label>
              <p class="text-xs text-muted-foreground">The task can't be raised without saying where.</p>
            </div>
            <Switch id="item-loc" v-model="formRequiresLocation" />
          </div>

          <!-- Proof gate: what finishing this task demands as evidence. -->
          <div class="space-y-3 rounded-lg border px-4 py-3">
            <p class="text-sm font-semibold text-foreground">Proof to finish</p>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="space-y-2">
                <Label for="item-photos">Min photos</Label>
                <Input id="item-photos" v-model="formMinPhotos" type="number" min="0" max="10" step="1" />
                <p class="text-xs" :class="proofPhotosInvalid ? 'text-destructive' : 'text-muted-foreground'">
                  Whole number, 0–10. 0 means no photo gate.
                </p>
              </div>
              <div class="space-y-2">
                <Label for="item-note" class="cursor-pointer">Completion note</Label>
                <div class="flex min-h-9 items-center gap-3">
                  <Switch id="item-note" v-model="formRequiresNote" />
                  <span class="text-xs text-muted-foreground">Finishing requires a written note.</span>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3 rounded-lg border px-4 py-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-foreground">Checklist</p>
                <p class="text-xs text-muted-foreground">Steps seeded onto every task raised from this item. Blank steps are dropped.</p>
              </div>
              <Button size="sm" variant="outline" type="button" @click="addChecklistStep">
                <PlusIcon />
                Add step
              </Button>
            </div>
            <div v-for="(step, index) in formChecklist" :key="index" class="flex items-center gap-2">
              <Input
                v-model="formChecklist[index]"
                :aria-label="`Checklist step ${index + 1}`"
                placeholder="e.g. Restock amenities"
                maxlength="100"
              />
              <Button
                size="icon"
                variant="ghost"
                type="button"
                class="shrink-0 text-muted-foreground hover:text-destructive"
                :aria-label="`Remove checklist step ${index + 1}`"
                @click="removeChecklistStep(index)"
              >
                <Trash2Icon class="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="item-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Hidden items keep their history but can't be raised.</p>
            </div>
            <Switch id="item-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
