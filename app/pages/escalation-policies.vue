<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, SirenIcon, StarIcon, Trash2Icon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { EscalationPolicy, EscalationTriggerKind, HotelDepartment, Staff, Team } from '~/utils/clientFakeApi'
import { ESCALATION_MAX_STEPS, ESCALATION_TRIGGER_KINDS } from '~/utils/clientFakeApi'
import type { EscalationPolicyForm, ReassignValue } from '~/utils/escalation-form'
import { TRIGGER_LABELS, emptyPolicyForm, emptyStepForm, formProblem, formToWrite, policyToForm, stepProblem, triggerMin, triggerUnit } from '~/utils/escalation-form'
import { relativeTime } from '~/utils/task-ui'

/**
 * Escalation policies (feat/escalation): an ordered list of steps that fire
 * on a task's SLA clocks — tell someone, bump the priority, hand the work to
 * a person, team or department. A task takes the routing rule's policy, else
 * the SLA's, else the property's default.
 *
 * One POST upserts the policy AND its steps: a step sent with its id is
 * updated, one without is created, and a live step LEFT OUT is deleted. The
 * editor therefore keeps the loaded step ids and resends every kept step —
 * the mapping lives in `~/utils/escalation-form`, pinned by its own spec.
 */
const api = useTasksApi()

const policies = ref<EscalationPolicy[]>([])
const staff = ref<Staff[]>([])
const teams = ref<Team[]>([])
const departments = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const form = ref<EscalationPolicyForm>(emptyPolicyForm())

const dialogTitle = computed(() => (form.value.id ? 'Edit escalation policy' : 'New escalation policy'))
const problem = computed(() => formProblem(form.value))
const canSave = computed(() => !isSaving.value && problem.value === null)
const canAddStep = computed(() => form.value.steps.length < ESCALATION_MAX_STEPS)

/** Pickers offer only what the API will accept: active members, active teams, ACTIVE departments. */
const activeStaff = computed(() => staff.value.filter(s => s.isActive))
const activeTeams = computed(() => teams.value.filter(t => t.isActive))
const activeDepartments = computed(() => departments.value.filter(d => d.isActive))
const departmentName = computed(() => new Map(departments.value.map(d => [d.id, d.departmentName])))

// Replacing the property's default changes which policy every new task with
// no rule/SLA policy follows, so it is confirmed by name — as the SLA page does.
const defaultDialogOpen = ref(false)

function requestSave() {
  if (!canSave.value) return
  const currentDefault = policies.value.find(p => p.isDefault)
  if (form.value.isDefault && currentDefault && currentDefault.id !== form.value.id) {
    defaultDialogOpen.value = true
    return
  }
  void save()
}

function confirmDefault() {
  defaultDialogOpen.value = false
  void save()
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedPolicies, loadedStaff, loadedTeams, loadedDepartments] = await Promise.all([
      api.listEscalationPolicies(),
      api.listStaff(),
      api.listTeams(),
      api.listHotelDepartments(),
    ])
    policies.value = loadedPolicies
    staff.value = loadedStaff
    teams.value = loadedTeams
    departments.value = loadedDepartments
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function openCreate() {
  form.value = emptyPolicyForm()
  form.value.isDefault = policies.value.length === 0
  form.value.steps = [emptyStepForm()]
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(policy: EscalationPolicy) {
  // The list carries live steps by sort, ids included — the ids are what keep
  // an edit from deleting and recreating every step.
  form.value = policyToForm(policy)
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertEscalationPolicy(formToWrite(form.value))
    await load()
    dialogOpen.value = false
  }
  catch (e) {
    // The API names the step and the rule ("steps[1]: duplicate sort 0") — shown as is.
    formError.value = (e as Error).message
  }
  finally {
    isSaving.value = false
  }
}

// ── steps editor ─────────────────────────────────────────────────────────────

function addStep() {
  if (!canAddStep.value) return
  form.value.steps.push(emptyStepForm())
}

function removeStep(index: number) {
  form.value.steps.splice(index, 1)
}

/** Position IS the sort order, so moving a step renumbers everything on save. */
function moveStep(index: number, delta: -1 | 1) {
  const steps = form.value.steps
  const target = index + delta
  if (target < 0 || target >= steps.length) return
  const [step] = steps.splice(index, 1)
  steps.splice(target, 0, step!)
}

/** Switching kind clamps the value into the new kind's range so the hint stays true. */
function onTriggerKindChange(index: number, kind: EscalationTriggerKind) {
  const step = form.value.steps[index]!
  step.triggerKind = kind
  const min = triggerMin(kind)
  if (Number(step.triggerValue) < min) step.triggerValue = min
  if (kind === 'PERCENT_OF_RESOLUTION' && Number(step.triggerValue) > 100) step.triggerValue = 100
}

function toggleId(list: string[], id: string, checked: boolean) {
  const at = list.indexOf(id)
  if (checked && at === -1) list.push(id)
  if (!checked && at !== -1) list.splice(at, 1)
}

/** One-line summary of a step for the table's step count tooltip. */
function stepSummary(policy: EscalationPolicy) {
  return policy.steps.map(s => `${TRIGGER_LABELS[s.triggerKind]} ${s.triggerValue}${triggerUnit(s.triggerKind)}`).join(' → ')
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Escalation policies"
      description="What happens when a task runs late or sits unclaimed: who is told, and whether it is bumped, reassigned or re-routed."
      :icon="SirenIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New policy
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
          <SirenIcon class="mt-0.5 shrink-0 text-primary" />
          <p class="text-sm text-foreground">
            A task follows <span class="font-semibold">its routing rule's policy</span>, else its SLA's, else the property default.
            Steps fire in order on the task's open-hours clocks; each fires at most once per task.
            An inactive policy stops escalating until it is switched back on.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && policies.length === 0" :rows="3" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead />
                <TableHead>Status</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="policy in policies" :key="policy.id" :class="policy.isActive ? '' : 'opacity-55'">
                <TableCell class="font-medium text-foreground">{{ policy.name }}</TableCell>
                <TableCell>
                  <Badge v-if="policy.isDefault" variant="success">
                    <StarIcon />
                    Default
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="policy.isActive ? 'success' : 'secondary'">{{ policy.isActive ? 'Active' : 'Inactive' }}</Badge>
                </TableCell>
                <TableCell class="tabular-nums text-foreground" :title="stepSummary(policy)">
                  {{ policy.steps.length }} {{ policy.steps.length === 1 ? 'step' : 'steps' }}
                </TableCell>
                <TableCell class="whitespace-nowrap text-muted-foreground">{{ relativeTime(policy.updatedAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button size="sm" variant="outline" :aria-label="`Edit ${policy.name}`" @click="openEdit(policy)">
                    <PencilIcon />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && policies.length === 0">
                <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                  No policies yet — late tasks are not escalated until one exists.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>
            Steps run top to bottom. Minutes are open hours on the task's operating schedule; a percentage is of the SLA's resolution time.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="policy-name">Name</Label>
            <Input id="policy-name" v-model="form.name" placeholder="e.g. Standard escalation" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <Label for="policy-default" class="cursor-pointer">Property default</Label>
                <!-- One default per property: setting this one demotes the other, worth saying before the click. -->
                <p class="text-xs text-muted-foreground">For tasks whose rule and SLA name no policy. Replaces the current default.</p>
              </div>
              <Switch id="policy-default" v-model="form.isDefault" />
            </div>
            <div class="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <Label for="policy-active" class="cursor-pointer">Active</Label>
                <p class="text-xs text-muted-foreground">Inactive pauses every step; switching back on resumes, catch-up included.</p>
              </div>
              <Switch id="policy-active" v-model="form.isActive" />
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-foreground">Steps</p>
                <p class="text-xs text-muted-foreground">Up to {{ ESCALATION_MAX_STEPS }}. The order here is the firing order.</p>
              </div>
              <Button size="sm" variant="outline" :disabled="!canAddStep" @click="addStep">
                <PlusIcon />
                Add step
              </Button>
            </div>

            <p v-if="form.steps.length === 0" class="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No steps — this policy does nothing until one is added.
            </p>

            <div v-for="(step, index) in form.steps" :key="step.id ?? `new-${index}`" class="space-y-4 rounded-lg border bg-card p-4">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-foreground">Step {{ index + 1 }}</p>
                <div class="flex items-center gap-1">
                  <Button size="icon" variant="ghost" class="h-8 w-8" :disabled="index === 0" :aria-label="`Move step ${index + 1} up`" @click="moveStep(index, -1)">
                    <ArrowUpIcon class="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" class="h-8 w-8" :disabled="index === form.steps.length - 1" :aria-label="`Move step ${index + 1} down`" @click="moveStep(index, 1)">
                    <ArrowDownIcon class="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" class="h-8 w-8 text-muted-foreground hover:text-destructive" :aria-label="`Remove step ${index + 1}`" @click="removeStep(index)">
                    <Trash2Icon class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem]">
                <div class="space-y-2">
                  <Label>When</Label>
                  <Select :model-value="step.triggerKind" @update:model-value="value => onTriggerKindChange(index, value as EscalationTriggerKind)">
                    <SelectTrigger class="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="kind in ESCALATION_TRIGGER_KINDS" :key="kind" :value="kind">{{ TRIGGER_LABELS[kind] }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="space-y-2">
                  <Label :for="`step-${index}-value`">Value</Label>
                  <div class="flex items-center gap-2">
                    <Input :id="`step-${index}-value`" v-model.number="step.triggerValue" type="number" :min="triggerMin(step.triggerKind)" :max="step.triggerKind === 'PERCENT_OF_RESOLUTION' ? 100 : undefined" step="1" />
                    <span class="w-8 shrink-0 text-sm text-muted-foreground">{{ triggerUnit(step.triggerKind) }}</span>
                  </div>
                </div>
              </div>
              <p v-if="stepProblem(step)" role="alert" class="text-xs font-medium text-destructive">{{ stepProblem(step) }}</p>

              <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div class="space-y-3">
                  <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Do</p>
                  <label class="flex items-center gap-2.5 text-sm text-foreground">
                    <Checkbox v-model="step.bumpPriority" />
                    Bump priority
                  </label>
                  <div class="space-y-1.5">
                    <Label class="text-xs text-muted-foreground">Reassign to</Label>
                    <Select :model-value="toSelectValue(step.reassign)" @update:model-value="value => step.reassign = fromSelectValue(value) as ReassignValue">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Nobody" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="SELECT_EMPTY">Nobody</SelectItem>
                        <SelectItem v-for="team in activeTeams" :key="team.id" :value="`team:${team.id}`">Team: {{ team.name }}</SelectItem>
                        <SelectItem v-for="person in activeStaff" :key="person.id" :value="`staff:${person.id}`">{{ person.name }}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div class="space-y-1.5">
                    <Label class="text-xs text-muted-foreground">Route to department</Label>
                    <Select :model-value="toSelectValue(step.routeToDepartmentId)" @update:model-value="value => step.routeToDepartmentId = fromSelectValue(value)">
                      <SelectTrigger class="w-full">
                        <SelectValue placeholder="Keep its department" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem :value="SELECT_EMPTY">Keep its department</SelectItem>
                        <SelectItem v-for="dept in activeDepartments" :key="dept.id" :value="dept.id">{{ dept.departmentName }}</SelectItem>
                        <!-- A department that went inactive after the step was saved is kept visible, so the admin sees why the API will refuse it. -->
                        <SelectItem v-if="step.routeToDepartmentId && !activeDepartments.some(d => d.id === step.routeToDepartmentId)" :value="step.routeToDepartmentId">
                          {{ departmentName.get(step.routeToDepartmentId) ?? step.routeToDepartmentId }} (inactive)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div class="space-y-3">
                  <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tell</p>
                  <div class="flex flex-wrap gap-x-5 gap-y-2">
                    <label class="flex items-center gap-2.5 text-sm text-foreground">
                      <Checkbox v-model="step.notifyDepartmentLeaders" />
                      Department leaders
                    </label>
                    <label class="flex items-center gap-2.5 text-sm text-foreground">
                      <Checkbox v-model="step.notifyAdmins" />
                      Admins
                    </label>
                    <label class="flex items-center gap-2.5 text-sm text-foreground">
                      <Checkbox v-model="step.notifyAssignee" />
                      Previous assignee
                    </label>
                  </div>
                  <div v-if="activeTeams.length" class="space-y-1.5">
                    <p class="text-xs text-muted-foreground">Teams</p>
                    <div class="flex flex-wrap gap-x-5 gap-y-2">
                      <label v-for="team in activeTeams" :key="team.id" class="flex items-center gap-2.5 text-sm text-foreground">
                        <Checkbox :model-value="step.notifyTeamIds.includes(team.id)" @update:model-value="checked => toggleId(step.notifyTeamIds, team.id, checked === true)" />
                        {{ team.name }}
                      </label>
                    </div>
                  </div>
                  <div v-if="activeStaff.length" class="space-y-1.5">
                    <p class="text-xs text-muted-foreground">People</p>
                    <div class="flex max-h-36 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">
                      <label v-for="person in activeStaff" :key="person.id" class="flex items-center gap-2.5 text-sm text-foreground">
                        <Checkbox :model-value="step.notifyStaffIds.includes(person.id)" @update:model-value="checked => toggleId(step.notifyStaffIds, person.id, checked === true)" />
                        {{ person.name }}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p v-if="problem" role="alert" class="text-xs font-medium text-destructive">{{ problem }}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="requestSave">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="defaultDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Change the default escalation policy?</AlertDialogTitle>
          <AlertDialogDescription>
            Making “{{ form.name }}” the default changes how every new task with no rule or SLA policy escalates.
            Tasks already created keep the policy they were given.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDefault">Set as default</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
