<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MapPinnedIcon, PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Category, CatalogItem, EscalationPolicy, HotelDepartment, LocationType, RoutingRule, Sla, TaskPriority } from '~/utils/clientFakeApi'
import { TASK_PRIORITIES, priorityMeta } from '~/utils/task-ui'

/**
 * Routing in the real API is specificity-tiered and keyed by its matcher:
 * PUT /v1/routing-rules carries AT MOST ONE of itemRef / categoryId /
 * locationTypeId / priority (none at all = the catch-all), and repeating a
 * matcher updates that rule in place — there is no id in the request and no
 * priority number to maintain. Tiers: item 4 > category 3 > location type 2 >
 * priority 1 > catch-all 0; within a tier the most recently updated wins.
 */
const api = useTasksApi()

const rules = ref<RoutingRule[]>([])
const departments = ref<HotelDepartment[]>([])
const slas = ref<Sla[]>([])
const policies = ref<EscalationPolicy[]>([])
const items = ref<CatalogItem[]>([])
const categories = ref<Category[]>([])
const locationTypes = ref<LocationType[]>([])

const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
/** Editing = re-PUTting the same matcher; the matcher is the identity. */
const editingRule = ref<RoutingRule | null>(null)
const formMatchKind = ref<'item' | 'category' | 'locationType' | 'priority' | 'catchall'>('category')
const formMatchValue = ref('')
const formDepartmentId = ref('')
const formSlaId = ref('')
/** '' = none of its own: the SLA's policy, else the property default. */
const formPolicyId = ref('')
const formRemark = ref('')

const TIER_LABELS: Record<number, string> = { 4: 'Item', 3: 'Category', 2: 'Location type', 1: 'Priority', 0: 'Catch-all' }

/** Only an ACTIVE policy may be linked; a link that went inactive since stays visible (marked) so the refusal makes sense. */
const policyOptions = computed(() => {
  const active = policies.value.filter(p => p.isActive)
  const linked = policies.value.find(p => p.id === formPolicyId.value)
  return linked && !linked.isActive ? [...active, linked] : active
})

const nameById = computed(() => ({
  department: new Map(departments.value.map(d => [d.id, d.departmentName])),
  sla: new Map(slas.value.map(s => [s.id, s.name])),
  policy: new Map(policies.value.map(p => [p.id, p.name])),
  item: new Map(items.value.map(i => [i.id, i.name])),
  category: new Map(categories.value.map(c => [c.id, c.name])),
  locationType: new Map(locationTypes.value.map(t => [t.id, t.name])),
}))

/** Human description of a rule's matcher — tier included, so an "Item: Towels"
 *  and a "Category: Towels" rule stay tellable apart in every confirmation. */
function matchLabel(rule: RoutingRule) {
  const tier = TIER_LABELS[rule.specificity] ?? '—'
  if (rule.itemRef) return { kind: tier, value: nameById.value.item.get(rule.itemRef) ?? rule.itemRef }
  if (rule.categoryId) return { kind: tier, value: nameById.value.category.get(rule.categoryId) ?? rule.categoryId }
  if (rule.locationTypeId) return { kind: tier, value: nameById.value.locationType.get(rule.locationTypeId) ?? rule.locationTypeId }
  if (rule.priority) return { kind: tier, value: priorityMeta(rule.priority).label }
  return { kind: tier, value: 'Everything unmatched above' }
}

const matchText = (rule: RoutingRule) => `${matchLabel(rule).kind}: ${matchLabel(rule).value}`

/**
 * Active items no rule would route by item or category. A location-type,
 * priority or catch-all rule may still pick such a task up at creation time,
 * so with a catch-all in place nothing can fall through at all.
 */
const unroutedItems = computed(() => {
  if (rules.value.some(rule => rule.specificity === 0)) return []
  const itemIds = new Set(rules.value.map(rule => rule.itemRef).filter(Boolean))
  const categoryIds = new Set(rules.value.map(rule => rule.categoryId).filter(Boolean))
  return items.value.filter(item =>
    item.isActive && !itemIds.has(item.id) && !(item.categoryId && categoryIds.has(item.categoryId)),
  )
})

const matchOptions = computed(() => {
  switch (formMatchKind.value) {
    case 'item': return items.value.filter(i => i.isActive).map(i => ({ value: i.id, label: i.name }))
    case 'category': return categories.value.map(c => ({ value: c.id, label: c.name }))
    case 'locationType': return locationTypes.value.filter(t => t.isActive).map(t => ({ value: t.id, label: t.name }))
    case 'priority': return TASK_PRIORITIES.map(p => ({ value: p, label: priorityMeta(p).label }))
    default: return []
  }
})

const dialogTitle = computed(() => (editingRule.value ? 'Edit routing rule' : 'New rule'))
const needsMatchValue = computed(() => formMatchKind.value !== 'catchall')

// ── delete confirmation ───────────────────────────────────────────────────────

const deleteDialogOpen = ref(false)
const isDeleting = ref(false)
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

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedRules, loadedDepts, loadedSlas, loadedItems, loadedCategories, loadedLocationTypes, loadedPolicies] = await Promise.all([
      api.listRoutingRules(),
      api.listHotelDepartments(),
      api.listSlas(),
      api.listCatalogItems(),
      api.listCategories(),
      api.listLocationTypes(),
      api.listEscalationPolicies(),
    ])
    rules.value = loadedRules
    departments.value = loadedDepts
    slas.value = loadedSlas
    policies.value = loadedPolicies
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
  editingRule.value = null
  formMatchKind.value = 'category'
  formMatchValue.value = ''
  formDepartmentId.value = departments.value[0]?.id ?? ''
  formSlaId.value = slas.value.find(s => s.isDefault)?.id ?? slas.value[0]?.id ?? ''
  formPolicyId.value = ''
  formRemark.value = ''
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(rule: RoutingRule) {
  editingRule.value = rule
  formMatchKind.value = rule.itemRef ? 'item' : rule.categoryId ? 'category' : rule.locationTypeId ? 'locationType' : rule.priority ? 'priority' : 'catchall'
  formMatchValue.value = rule.itemRef ?? rule.categoryId ?? rule.locationTypeId ?? rule.priority ?? ''
  formDepartmentId.value = rule.hotelDepartmentId
  formSlaId.value = rule.slaId
  formPolicyId.value = rule.escalationPolicyId ?? ''
  formRemark.value = rule.remark ?? ''
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    // PUT is idempotent on the matcher — the natural key. Repeating one
    // deliberately updates the existing rule rather than stacking a twin.
    await api.upsertRoutingRule({
      itemRef: formMatchKind.value === 'item' ? formMatchValue.value : null,
      categoryId: formMatchKind.value === 'category' ? formMatchValue.value : null,
      locationTypeId: formMatchKind.value === 'locationType' ? formMatchValue.value : null,
      priority: formMatchKind.value === 'priority' ? formMatchValue.value as TaskPriority : null,
      departmentId: formDepartmentId.value,
      slaId: formSlaId.value,
      remark: formRemark.value.trim() || null,
      // Always sent: the key ABSENT would keep the stored link; null clears it.
      escalationPolicyId: formPolicyId.value || null,
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
      <AlertTitle>Enable departments and SLAs first</AlertTitle>
      <AlertDescription>A rule has to point at a department and an SLA, so those come first.</AlertDescription>
    </Alert>

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
            The matcher IS the rule's identity — saving the same matcher again updates that rule in place.
            A task matching nothing gets the property's default SLA and no department, so it stays visible to everyone.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && rules.length === 0" :rows="5" :columns="7" />

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
                <TableHead>Escalation</TableHead>
                <TableHead>Note</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="rule in rules" :key="rule.id">
                <TableCell>
                  <Badge variant="outline" class="text-[10px]">{{ matchLabel(rule).kind }}</Badge>
                </TableCell>
                <TableCell class="text-foreground">{{ matchLabel(rule).value }}</TableCell>
                <TableCell class="text-foreground">{{ nameById.department.get(rule.hotelDepartmentId) ?? '—' }}</TableCell>
                <TableCell class="text-foreground">{{ nameById.sla.get(rule.slaId) ?? '—' }}</TableCell>
                <TableCell class="text-foreground">{{ rule.escalationPolicyId ? (nameById.policy.get(rule.escalationPolicyId) ?? rule.escalationPolicyId) : '—' }}</TableCell>
                <TableCell class="max-w-56 truncate text-muted-foreground">{{ rule.remark ?? '—' }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
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
                <TableCell colspan="7" class="py-10 text-center text-sm text-muted-foreground">
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
            <Select v-model="formMatchKind" :disabled="Boolean(editingRule)" @update:model-value="formMatchValue = ''">
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
            <p class="text-xs text-muted-foreground">
              {{ editingRule ? 'The matcher is the rule\'s identity — delete and recreate to change it.' : 'The matcher is the rule\'s specificity tier — more specific tiers win.' }}
            </p>
          </div>

          <div v-if="needsMatchValue" class="space-y-2">
            <Label>Value</Label>
            <Select v-model="formMatchValue" :disabled="Boolean(editingRule)">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select a value" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in matchOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Send to department</Label>
              <Select v-model="formDepartmentId">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.departmentName }}</SelectItem>
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
            <Label>Escalation policy</Label>
            <Select :model-value="toSelectValue(formPolicyId)" @update:model-value="value => formPolicyId = fromSelectValue(value)">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="None — follow the SLA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="SELECT_EMPTY">None — follow the SLA</SelectItem>
                <SelectItem v-for="policy in policyOptions" :key="policy.id" :value="policy.id">
                  {{ policy.name }}{{ policy.isActive ? '' : ' (inactive)' }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">Wins over the SLA's policy for the tasks this rule routes.</p>
          </div>

          <div class="space-y-2">
            <Label for="rule-remark">Note</Label>
            <Input id="rule-remark" v-model="formRemark" placeholder="Why this rule exists (optional)" />
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
  </div>
</template>
