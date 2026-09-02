<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, ShapesIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { Category } from '~/utils/clientFakeApi'

const api = useTasksApi()

const categories = ref<Category[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formCode = ref('')
const formIcon = ref('')
/** Held as a string so a cleared field is distinguishable from a typed 0. */
const formSort = ref('1')
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit category' : 'New category'))

function isValidSort(raw: string) {
  const text = String(raw).trim()
  if (!text) return false
  const value = Number(text)
  return Number.isInteger(value) && value >= 0
}

const canSave = computed(() =>
  !isSaving.value && Boolean(formName.value.trim()) && Boolean(formCode.value.trim()) && isValidSort(formSort.value),
)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    categories.value = await api.listCategories()
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
  formCode.value = ''
  formIcon.value = ''
  formSort.value = String(categories.value.length + 1)
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(category: Category) {
  editId.value = category.id
  formName.value = category.name
  formCode.value = category.code
  formIcon.value = category.icon ?? ''
  formSort.value = String(category.sort)
  formActive.value = category.isActive
  formError.value = ''
  dialogOpen.value = true
}

async function save() {
  if (isSaving.value) return
  isSaving.value = true
  formError.value = ''
  try {
    await api.upsertCategory({
      id: editId.value,
      name: formName.value,
      code: formCode.value,
      icon: formIcon.value.trim() || null,
      sort: Number(formSort.value),
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
      title="Categories"
      description="How this property's catalog is grouped — for staff picking an item, and for routing rules matching a whole group."
      :icon="ShapesIcon"
    >
      <template #actions>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          New category
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

    <TableSkeleton v-if="isLoading && categories.length === 0" :rows="4" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Code</TableHead>
              <TableHead class="w-16">Sort</TableHead>
              <TableHead>Status</TableHead>
              <TableHead class="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="category in categories" :key="category.id" :class="category.isActive ? '' : 'opacity-55'">
              <TableCell class="font-medium text-foreground">
                <span v-if="category.icon" aria-hidden="true" class="mr-1.5">{{ category.icon }}</span>{{ category.name }}
              </TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ category.code }}</TableCell>
              <TableCell class="tabular-nums text-muted-foreground">{{ category.sort }}</TableCell>
              <TableCell>
                <Badge :variant="category.isActive ? 'success' : 'secondary'">
                  {{ category.isActive ? 'Active' : 'Deactivated' }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button size="sm" variant="outline" :aria-label="`Edit ${category.name}`" @click="openEdit(category)">
                  <PencilIcon />
                  Edit
                </Button>
              </TableCell>
            </TableRow>
            <TableRow v-if="!isLoading && categories.length === 0">
              <TableCell colspan="5" class="py-10 text-center text-sm text-muted-foreground">
                No categories yet. The catalog needs at least one before items can be added.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>

    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ dialogTitle }}</DialogTitle>
          <DialogDescription>Categories are per property, like the items they group.</DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="space-y-2">
            <Label for="cat-name">Name</Label>
            <Input id="cat-name" v-model="formName" placeholder="e.g. Housekeeping" maxlength="100" />
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div class="space-y-2">
              <Label for="cat-code">Code</Label>
              <Input id="cat-code" v-model="formCode" placeholder="HK" maxlength="50" class="uppercase" />
            </div>
            <div class="space-y-2">
              <Label for="cat-icon">Icon</Label>
              <Input id="cat-icon" v-model="formIcon" placeholder="🧹" maxlength="8" />
            </div>
            <div class="space-y-2">
              <Label for="cat-sort">Sort</Label>
              <Input id="cat-sort" v-model="formSort" type="number" min="0" step="1" />
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="cat-active" class="cursor-pointer">Active</Label>
              <!-- Items keep a deactivated category, but nothing new can pick it. -->
              <p class="text-xs text-muted-foreground">Deactivated categories keep their items but can't be chosen for new ones.</p>
            </div>
            <Switch id="cat-active" v-model="formActive" />
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
