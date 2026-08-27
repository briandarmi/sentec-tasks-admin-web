<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, UtensilsCrossedIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import type { CatalogCategory, CatalogItem } from '~/utils/clientFakeApi'

const api = useTasksApi()

const categories = ref<CatalogCategory[]>([])
const items = ref<CatalogItem[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
const formName = ref('')
const formCategoryId = ref('')
const formQuantity = ref(false)
const formActive = ref(true)

const dialogTitle = computed(() => (editId.value ? 'Edit item' : 'New catalog item'))

/** Group by category, keeping empty categories out of the way. */
const groups = computed(() =>
  categories.value
    .map(category => ({ category, items: items.value.filter(item => item.categoryId === category.id) }))
    .filter(group => group.items.length > 0),
)

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [loadedCategories, loadedItems] = await Promise.all([
      api.listCatalogCategories(),
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
  formCategoryId.value = categories.value[0]?.id ?? ''
  formQuantity.value = false
  formActive.value = true
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(item: CatalogItem) {
  editId.value = item.id
  formName.value = item.name
  formCategoryId.value = item.categoryId
  formQuantity.value = item.quantityEnabled
  formActive.value = item.isActive
  formError.value = ''
  dialogOpen.value = true
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
      quantityEnabled: formQuantity.value,
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
        <Button size="sm" :disabled="!categories.length" @click="openCreate">
          <PlusIcon />
          New item
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>{{ errorMessage }}</AlertDescription>
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
            <NuxtLink to="/routing" class="font-semibold text-primary underline-offset-2 hover:underline">routing rules</NuxtLink>.
          </p>
        </div>
      </CardContent>
    </Card>

    <TableSkeleton v-if="isLoading && items.length === 0" :rows="6" :columns="4" />

    <EmptyState
      v-else-if="items.length === 0"
      :icon="UtensilsCrossedIcon"
      title="Nothing in the catalog yet"
      description="Add the requests this property handles, so staff can raise them in one tap."
    >
      <Button v-if="categories.length" size="sm" @click="openCreate">
        <PlusIcon />
        New item
      </Button>
    </EmptyState>

    <section v-for="group in groups" v-else :key="group.category.id" class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        <span aria-hidden="true">{{ group.category.icon }}</span>
        {{ group.category.name }}
      </h2>
      <Card class="overflow-hidden rounded-xl pt-0">
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in group.items" :key="item.id" :class="item.isActive ? '' : 'opacity-55'">
                <TableCell class="font-medium text-foreground">{{ item.name }}</TableCell>
                <TableCell>
                  <Badge :variant="item.quantityEnabled ? 'secondary' : 'outline'">
                    {{ item.quantityEnabled ? 'Takes a number' : 'Single' }}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="item.isActive ? 'success' : 'secondary'">
                    {{ item.isActive ? 'Active' : 'Hidden' }}
                  </Badge>
                </TableCell>
                <TableCell class="text-right">
                  <Button size="sm" variant="outline" @click="openEdit(item)">
                    <PencilIcon />
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
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
            <Label>Category</Label>
            <Select v-model="formCategoryId">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="category in categories" :key="category.id" :value="category.id">
                  {{ category.icon }} {{ category.name }}
                </SelectItem>
              </SelectContent>
            </Select>
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
              <Label for="item-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Hidden items keep their history but can't be raised.</p>
            </div>
            <Switch id="item-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="isSaving || !formName.trim() || !formCategoryId" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
