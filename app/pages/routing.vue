<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MapPinnedIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { CatalogCategory, CatalogItem, Department, LocationType, RoutingRule, Sla, TaskPriority } from '~/utils/clientFakeApi'
import { routingTier } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES, priorityMeta } from '~/utils/task-ui'

const api = useTasksApi()

const rules = ref<RoutingRule[]>([])
const departments = ref<Department[]>([])
const slas = ref<Sla[]>([])
const items = ref<CatalogItem[]>([])
const categories = ref<CatalogCategory[]>([])
const locationTypes = ref<LocationType[]>([])

const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
/**
 * Exactly one matcher — the matcher IS the rule's specificity tier, so a rule
 * matching two things at once would sit in two tiers and be impossible to
 * trace. "Catch-all" is the deliberate no-matcher tier at the bottom.
 */
const formMatchKind = ref<'item' | 'category' | 'locationType' | 'priority' | 'catchall'>('category')
const formMatchValue = ref('')
const formDepartmentId = ref('')
const formSlaId = ref('')
const formRemark = ref('')
const formActive = ref(true)

const TIER_LABELS: Record<string, string> = {
  ITEM: 'Item',
  CATEGORY: 'Category',
  LOCATION_TYPE: 'Location type',
  PRIORITY: 'Priority',
  CATCH_ALL: 'Catch-all',
}

const nameById = computed(() => ({
  department: new Map(departments.value.map(d => [d.id, d.name])),
  sla: new Map(slas.value.map(s => [s.id, s.name])),
  item: new Map(items.value.map(i => [i.id, i.name])),
  category: new Map(categories.value.map(c => [c.id, c.name])),
  locationType: new Map(locationTypes.value.map(t => [t.id, t.name])),
}))

/**
 * Human description of what a rule matches on. The tier is part of the name —
 * an "Item: Towels" rule and a "Category: Towels" rule must stay tellable
 * apart everywhere they are quoted, especially in the delete confirmation.
 */
function matchLabel(rule: RoutingRule) {
  const tier = TIER_LABELS[routingTier(rule)] ?? '—'
  if (rule.matchItemId) return { kind: tier, value: nameById.value.item.get(rule.matchItemId) ?? rule.matchItemId }
  if (rule.matchCategoryId) return { kind: tier, value: nameById.value.category.get(rule.matchCategoryId) ?? rule.matchCategoryId }
  if (rule.matchLocationTypeId) return { kind: tier, value: nameById.value.locationType.get(rule.matchLocationTypeId) ?? rule.matchLocationTypeId }
  if (rule.matchPriority) return { kind: tier, value: priorityMeta(rule.matchPriority).label }
  return { kind: tier, value: 'Everything unmatched above' }
}

function matchText(rule: RoutingRule) {
  const label = matchLabel(rule)
  return `${label.kind}: ${label.value}`
}

/**
 * Active items no active rule would route: nothing matches the item itself and
 * nothing matches its category. (A location-type, priority or catch-all rule
 * may still pick the task up at creation time, but that depends on how it is
 * raised — so the warning stays about the item-level guarantees.) With an
 * active catch-all in place, nothing can fall through at all.
 */
const unroutedItems = computed(() => {
  const active = rules.value.filter(rule => rule.isActive)
  if (active.some(rule => routingTier(rule) === 'CATCH_ALL')) return []
  const itemIds = new Set(active.map(rule => rule.matchItemId).filter(Boolean))
  const categoryIds = new Set(active.map(rule => rule.matchCategoryId).filter(Boolean))
  return items.value.filter(item =>
    item.isActive && !itemIds.has(item.id) && !categoryIds.has(item.categoryId),
  )
})

/** Items without an item-scoped rule — what the create form's picker offers. */
const itemsWithoutItemRule = computed(() => {
  const itemIds = new Set(rules.value.map(rule => rule.matchItemId).filter(Boolean))
  return items.value.filter(item => !itemIds.has(item.id))
})

const matchOptions = computed(() => {
  switch (formMatchKind.value) {
    case 'item': {
      // Creating offers only items not already matched by an item rule; the
      // edited rule's own item stays choosable so the form can round-trip.
      const options = itemsWithoutItemRule.value.map(i => ({ value: i.id, label: i.name }))
      const current = formMatchValue.value
      if (editId.value && current && !options.some(option => option.value === current)) {
        const item = items.value.find(i => i.id === current)
        if (item) options.unshift({ value: item.id, label: item.name })
      }
      return options
    }
    case 'category': return categories.value.map(c => ({ value: c.id, label: c.name }))
    case 'locationType': return locationTypes.value.filter(t => t.isActive).map(t => ({ value: t.id, label: t.name }))
    case 'priority': return TASK_PRIORITIES.map(p => ({ value: p, label: priorityMeta(p).label }))
    default: return []
  }
})

const dialogTitle = computed(() => (editId.value ? 'Edit routing rule' : 'New routing rule'))
const needsMatchValue = computed(() => formMatchKind.value !== 'catchall')

// ── delete confirmation ───────────────────────────────────────────────────────

const deleteDialogOpen = ref(false)
const isDeleting = ref(false)
/** Snapshotted at request time, so the dialog names the right rule even if the
 *  list refreshes while it is open. */
const deleteTarget = ref<{ id: string, label: string } | null>(null)

function requestDelete(rule: RoutingRule) {
  deleteTarget.value = { id: rule.id, label: matchText(rule) }
  deleteDialogOpen.value = true
}

async function performDelete() {
  const target = deleteTarget.value
  if (!target || isDeleting.value) return
  isDeleting.value = true
  errorMessage.value = ''
  try {
    await api.deleteRoutingRule(target.id)
    await load()
    deleteDialogOpen.value = false
    deleteTarget.value = null
  }
  catch (e) {
    errorMessage.value = (e as Error).message
    deleteDialogOpen.value = false
  }
  finally {
    isDeleting.value = false
  }
}

// ── duplicate-matcher confirmation ────────────────────────────────────────────

const duplicateDialogOpen = ref(false)
const duplicateLabel = ref('')

/** An existing rule matching the exact same thing as the create form. */
function collidingRule(): RoutingRule | undefined {
  const value = formMatchValue.value
  switch (formMatchKind.value) {
    case 'item': return rules.value.find(rule => rule.matchItemId === value)
    case 'category': return rules.value.find(rule => rule.matchCategoryId === value)
    case 'locationType': return rules.value.find(rule => rule.matchLocationTypeId === value)
    case 'priority': return rules.value.find(rule => rule.matchPriority === value)
    default: return rules.value.find(rule => routingTier(rule) === 'CATCH_ALL')
  }
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedRules, loadedDepts, loadedSlas, loadedItems, loadedCategories, loadedLocationTypes] = await Promise.all([
      api.listRoutingRules(),
      api.listDepartments(),
      api.listSlas(),
      api.listCatalogItems(),
      api.listCatalogCategories(),
      api.listLocationTypes(),
    ])
    rules.value = loadedRules
    departments.value = loadedDepts
    slas.value = loadedSlas
    items.value = loadedItems
    categories.value = loadedCategories
    locationTypes.value = loadedLocationTypes
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
  formMatchKind.value = 'category'
  formMatchValue.value = ''
  formDepartmentId.value = departments.value[0]?.id ?? ''
  formSlaId.value = slas.value.find(s => s.isDefault)?.id ?? slas.value[0]?.id ?? ''
  formRemark.value = ''
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(rule: RoutingRule) {
  editId.value = rule.id
  formMatchKind.value = rule.matchItemId
    ? 'item'
    : rule.matchCategoryId
      ? 'category'
      : rule.matchLocationTypeId
        ? 'locationType'
        : rule.matchPriority ? 'priority' : 'catchall'
  formMatchValue.value = rule.matchItemId ?? rule.matchCategoryId ?? rule.matchLocationTypeId ?? rule.matchPriority ?? ''
  formDepartmentId.value = rule.departmentId
  formSlaId.value = rule.slaId
  formRemark.value = rule.remark ?? ''
  formActive.value = rule.isActive
  formError.value = ''
  dialogOpen.value = true
}

function save() {
  if (isSaving.value) return
  // Creating a second rule for the same matcher is usually a mistake — within
  // a tier the older rule silently wins. Say so before sending it.
  if (!editId.value) {
    const existing = collidingRule()
    if (existing) {
      duplicateLabel.value = matchText(existing)
      duplicateDialogOpen.value = true
      return
    }
  }
  void submit()
}

function confirmDuplicate() {
  duplicateDialogOpen.value = false
  void submit()
}

async function submit() {
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertRoutingRule({
      id: editId.value,
      matchItemId: formMatchKind.value === 'item' ? formMatchValue.value : null,
      matchCategoryId: formMatchKind.value === 'category' ? formMatchValue.value : null,
      matchLocationTypeId: formMatchKind.value === 'locationType' ? formMatchValue.value : null,
      matchPriority: formMatchKind.value === 'priority' ? formMatchValue.value as TaskPriority : null,
      departmentId: formDepartmentId.value,
      slaId: formSlaId.value,
      remark: formRemark.value.trim() || null,
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
      title="Routing rules"
      description="Decides which department a task lands in, and which SLA it carries."
      :icon="MapPinnedIcon"
    >
      <template #actions>
        <Button size="sm" :disabled="!departments.length || !slas.length" @click="openCreate">
          <PlusIcon />
          New rule
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

    <Alert v-if="!isLoading && (!departments.length || !slas.length)">
      <AlertTitle>Set up departments and SLAs first</AlertTitle>
      <AlertDescription>A rule has to point at a department and an SLA, so those come first.</AlertDescription>
    </Alert>

    <!-- Items no rule would route: they fall back to the default SLA with no
         department, so nobody in particular is responsible for them. -->
    <Alert v-if="!isLoading && unroutedItems.length" variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{{ unroutedItems.length }} catalog item{{ unroutedItems.length === 1 ? ' has' : 's have' }} no routing rule</AlertTitle>
      <AlertDescription>
        <p>
          Tasks raised for
          <span class="font-semibold">{{ unroutedItems.map(item => item.name).join(', ') }}</span>
          can land with no department, visible to everyone and owned by no one. Add a rule for the item or its
          category — or a catch-all rule as the floor.
        </p>
      </AlertDescription>
    </Alert>

    <Card class="rounded-xl">
      <CardContent>
        <div class="flex items-start gap-3">
          <MapPinnedIcon class="mt-0.5 shrink-0 text-primary" />
          <p class="text-sm text-foreground">
            Rules are matched <span class="font-semibold">most specific first</span>:
            exact item, then category, then location type, then priority, then the catch-all.
            The matcher decides the tier — there is no priority number to maintain.
            A task matching nothing gets the property's default SLA and no department, so it stays visible to everyone.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && rules.length === 0" :rows="5" :columns="6" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-32">Tier</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Note</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="rule in rules" :key="rule.id" :class="rule.isActive ? '' : 'opacity-55'">
                <TableCell>
                  <Badge variant="outline" class="text-[10px]">{{ matchLabel(rule).kind }}</Badge>
                </TableCell>
                <TableCell class="text-foreground">{{ matchLabel(rule).value }}</TableCell>
                <TableCell class="text-foreground">{{ nameById.department.get(rule.departmentId) ?? '—' }}</TableCell>
                <TableCell class="text-foreground">{{ nameById.sla.get(rule.slaId) ?? '—' }}</TableCell>
                <TableCell class="max-w-56 truncate text-muted-foreground">{{ rule.remark ?? '—' }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Badge v-if="!rule.isActive" variant="secondary">Off</Badge>
                    <Button size="sm" variant="outline" :aria-label="`Edit rule ${matchText(rule)}`" @click="openEdit(rule)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      :aria-label="`Delete rule ${matchText(rule)}`"
                      @click="requestDelete(rule)"
                    >
                      <Trash2Icon />
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && rules.length === 0">
                <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                  No rules yet — every task will fall back to the default SLA with no department.
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
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Match incoming work, then send it somewhere with a target.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label>Match on</Label>
            <Select v-model="formMatchKind" @update:model-value="formMatchValue = ''">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="item">Catalog item (most specific)</SelectItem>
                <SelectItem value="category">Category</SelectItem>
                <SelectItem value="locationType">Location type</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="catchall">Catch-all (everything unmatched)</SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">The matcher is the rule's specificity tier — more specific tiers win.</p>
          </div>

          <div v-if="needsMatchValue" class="space-y-2">
            <Label>Value</Label>
            <Select v-model="formMatchValue">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select a value" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in matchOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="formMatchKind === 'item' && !editId" class="text-xs text-muted-foreground">
              Only items without an item rule are offered — one item rule per item.
            </p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Send to department</Label>
              <Select v-model="formDepartmentId">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Apply SLA</Label>
              <Select v-model="formSlaId">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select SLA" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="sla in slas" :key="sla.id" :value="sla.id">{{ sla.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="space-y-2">
            <Label for="rule-remark">Note</Label>
            <Input id="rule-remark" v-model="formRemark" placeholder="Why this rule exists (optional)" />
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <Label for="rule-active" class="cursor-pointer">Active</Label>
            <Switch id="rule-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || (needsMatchValue && !formMatchValue) || !formDepartmentId || !formSlaId" @click="save">
            {{ isSaving ? 'Saving…' : 'Save rule' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deleteDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this routing rule?</AlertDialogTitle>
          <AlertDialogDescription>
            “{{ deleteTarget?.label }}” will no longer route matching tasks to a department or SLA. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isDeleting">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="isDeleting"
            @click.prevent="performDelete"
          >
            {{ isDeleting ? 'Deleting…' : 'Delete rule' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="duplicateDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>A rule already matches this</AlertDialogTitle>
          <AlertDialogDescription>
            A rule already matches on “{{ duplicateLabel }}”. Creating another will not replace it — within a tier
            the older rule wins, and the loser sits in the list doing nothing. Continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDuplicate">Create anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
