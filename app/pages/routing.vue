<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MapPinnedIcon, PencilIcon, PlusIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { CatalogCategory, CatalogItem, Department, RoutingRule, Sla } from '~/utils/clientFakeApi'

const api = useTasksApi()

const rules = ref<RoutingRule[]>([])
const departments = ref<Department[]>([])
const slas = ref<Sla[]>([])
const items = ref<CatalogItem[]>([])
const categories = ref<CatalogCategory[]>([])

const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formPriority = ref(50)
/** One matcher kind at a time — a rule that matched on three things at once
 *  would be impossible to reason about when tracing why a task landed somewhere. */
const formMatchKind = ref<'item' | 'category' | 'partner'>('category')
const formMatchValue = ref('')
const formDepartmentId = ref('')
const formSlaId = ref('')
const formRemark = ref('')
const formActive = ref(true)

const nameById = computed(() => ({
  department: new Map(departments.value.map(d => [d.id, d.name])),
  sla: new Map(slas.value.map(s => [s.id, s.name])),
  item: new Map(items.value.map(i => [i.id, i.name])),
  category: new Map(categories.value.map(c => [c.id, c.name])),
}))

/** Human description of what a rule matches on. */
function matchLabel(rule: RoutingRule) {
  if (rule.matchItemId) return { kind: 'Item', value: nameById.value.item.get(rule.matchItemId) ?? rule.matchItemId }
  if (rule.matchCategoryId) return { kind: 'Category', value: nameById.value.category.get(rule.matchCategoryId) ?? rule.matchCategoryId }
  if (rule.matchPartnerId) return { kind: 'Partner', value: `Partner ${rule.matchPartnerId}` }
  return { kind: '—', value: '—' }
}

const matchOptions = computed(() => {
  switch (formMatchKind.value) {
    case 'item': return items.value.map(i => ({ value: i.id, label: i.name }))
    case 'category': return categories.value.map(c => ({ value: c.id, label: c.name }))
    // Partner ids come from the platform area; an admin picks by the id they
    // were given rather than browsing every registered partner.
    default: return []
  }
})

const dialogTitle = computed(() => (editId.value ? 'Edit routing rule' : 'New routing rule'))

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedRules, loadedDepts, loadedSlas, loadedItems, loadedCategories] = await Promise.all([
      api.listRoutingRules(),
      api.listDepartments(),
      api.listSlas(),
      api.listCatalogItems(),
      api.listCatalogCategories(),
    ])
    rules.value = loadedRules
    departments.value = loadedDepts
    slas.value = loadedSlas
    items.value = loadedItems
    categories.value = loadedCategories
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
  formPriority.value = 50
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
  formPriority.value = rule.priority
  formMatchKind.value = rule.matchItemId ? 'item' : rule.matchPartnerId ? 'partner' : 'category'
  formMatchValue.value = rule.matchItemId ?? rule.matchCategoryId ?? rule.matchPartnerId ?? ''
  formDepartmentId.value = rule.departmentId
  formSlaId.value = rule.slaId
  formRemark.value = rule.remark ?? ''
  formActive.value = rule.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertRoutingRule({
      id: editId.value,
      priority: Number(formPriority.value),
      matchItemId: formMatchKind.value === 'item' ? formMatchValue.value : null,
      matchCategoryId: formMatchKind.value === 'category' ? formMatchValue.value : null,
      matchPartnerId: formMatchKind.value === 'partner' ? formMatchValue.value : null,
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
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>

    <Alert v-if="!isLoading && (!departments.length || !slas.length)">
      <AlertTitle>Set up departments and SLAs first</AlertTitle>
      <AlertDescription>A rule has to point at a department and an SLA, so those come first.</AlertDescription>
    </Alert>

    <Card class="rounded-xl">
      <CardContent>
        <div class="flex items-start gap-3">
          <MapPinnedIcon class="mt-0.5 shrink-0 text-primary" />
          <p class="text-sm text-foreground">
            Rules are evaluated by <span class="font-semibold">priority</span>, lowest first, and the first match wins.
            Keep specific rules (a single catalog item) on a low number and broad fallbacks high.
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
                <TableHead class="w-20">Priority</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Note</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="rule in rules" :key="rule.id" :class="rule.isActive ? '' : 'opacity-55'">
                <TableCell class="font-semibold tabular-nums text-foreground">{{ rule.priority }}</TableCell>
                <TableCell>
                  <div class="flex items-center gap-2">
                    <Badge variant="outline" class="text-[10px]">{{ matchLabel(rule).kind }}</Badge>
                    <span class="text-foreground">{{ matchLabel(rule).value }}</span>
                  </div>
                </TableCell>
                <TableCell class="text-foreground">{{ nameById.department.get(rule.departmentId) ?? '—' }}</TableCell>
                <TableCell class="text-foreground">{{ nameById.sla.get(rule.slaId) ?? '—' }}</TableCell>
                <TableCell class="max-w-56 truncate text-muted-foreground">{{ rule.remark ?? '—' }}</TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Badge v-if="!rule.isActive" variant="secondary">Off</Badge>
                    <Button size="sm" variant="outline" @click="openEdit(rule)">
                      <PencilIcon />
                      Edit
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
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="rule-priority">Priority</Label>
              <Input id="rule-priority" v-model.number="formPriority" type="number" min="1" max="999" />
              <p class="text-xs text-muted-foreground">Lower runs first.</p>
            </div>
            <div class="space-y-2">
              <Label>Match on</Label>
              <Select v-model="formMatchKind">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="item">Catalog item</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="partner">Source partner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="space-y-2">
            <Label>{{ formMatchKind === 'partner' ? 'Partner ID' : 'Value' }}</Label>
            <Input
              v-if="formMatchKind === 'partner'"
              v-model="formMatchValue"
              placeholder="e.g. 1"
            />
            <Select v-else v-model="formMatchValue">
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
          <Button :disabled="isSaving || !formMatchValue || !formDepartmentId || !formSlaId" @click="save">
            {{ isSaving ? 'Saving…' : 'Save rule' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
