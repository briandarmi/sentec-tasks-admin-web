<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { LanguagesIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'

/**
 * The vertical profile's product terms — the keys the API merges over.
 * `project` joined with feat/projects; there is no `projects` key.
 */
const TERMINOLOGY_KEYS = ['requester', 'visit', 'location', 'department', 'project'] as const
type TerminologyKey = typeof TERMINOLOGY_KEYS[number]

const api = useTasksApi()

const TERM_LABELS: Record<TerminologyKey, string> = {
  requester: 'Requester field',
  visit: 'Visit field',
  location: 'Location field',
  department: 'Department field',
  project: 'Project field',
}

const TERM_HINTS: Record<TerminologyKey, string> = {
  requester: 'Who asked for the work — a hotel might say "Guest".',
  visit: 'The stay or appointment a task belongs to.',
  location: 'Where the work is — "Room", "Unit", "Ward"…',
  department: 'The group work is routed to.',
  project: 'A bundle of related tasks with its own manager and members — "Programme", "Job", "Case"…',
}

function emptyTerms(): Record<TerminologyKey, string> {
  return { requester: '', visit: '', location: '', department: '', project: '' }
}

const isLoading = ref(false)
const loadError = ref('')
/** Last-saved values, so Save stays disabled until something actually changed. */
const values = ref(emptyTerms())
const drafts = ref(emptyTerms())
/** Each term saves independently — one term's request never blocks another's. */
const pending = ref(new Set<TerminologyKey>())
const rowErrors = ref(new Map<TerminologyKey, string>())

async function load() {
  isLoading.value = true
  loadError.value = ''
  try {
    const map = await api.getTerminology()
    values.value = { ...emptyTerms(), ...map }
    drafts.value = { ...values.value }
  }
  catch (e) {
    loadError.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
}

function canSave(term: TerminologyKey) {
  const draft = drafts.value[term].trim()
  return Boolean(draft) && draft !== values.value[term] && !pending.value.has(term)
}

async function save(term: TerminologyKey) {
  const value = drafts.value[term].trim()
  if (!value || pending.value.has(term)) return
  pending.value = new Set(pending.value).add(term)
  const errors = new Map(rowErrors.value)
  errors.delete(term)
  rowErrors.value = errors
  try {
    const map = await api.setTerminologyTerm(term, value)
    values.value = { ...emptyTerms(), ...map }
    drafts.value = { ...drafts.value, [term]: values.value[term] }
  }
  catch (e) {
    rowErrors.value = new Map(rowErrors.value).set(term, (e as Error).message)
  }
  finally {
    const next = new Set(pending.value)
    next.delete(term)
    pending.value = next
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Terminology"
      description="Rename these terms to match your property — for example “Guest” instead of “Requester”."
      :icon="LanguagesIcon"
    />

    <!-- A failed load leaves nothing to edit, so the recovery has to live
         right here rather than in a full page reload. -->
    <Alert v-if="loadError" variant="destructive">
      <AlertTitle>Could not load the terminology</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ loadError }}</p>
        <Button size="sm" variant="secondary" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <TableSkeleton v-else-if="isLoading" :rows="5" :columns="2" />

    <Card v-else class="rounded-xl">
      <CardContent class="space-y-5">
        <div v-for="term in TERMINOLOGY_KEYS" :key="term" class="space-y-2">
          <Label :for="`term-${term}`">{{ TERM_LABELS[term] }}</Label>
          <div class="flex items-center gap-2">
            <Input
              :id="`term-${term}`"
              v-model="drafts[term]"
              maxlength="50"
              class="max-w-xs"
            />
            <Button
              size="sm"
              :disabled="!canSave(term)"
              :aria-busy="pending.has(term)"
              :aria-label="`Save ${TERM_LABELS[term]}`"
              @click="save(term)"
            >
              {{ pending.has(term) ? 'Saving…' : 'Save' }}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">{{ TERM_HINTS[term] }}</p>
          <p v-if="rowErrors.get(term)" role="alert" class="text-xs font-medium text-destructive">
            {{ rowErrors.get(term) }}
          </p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
