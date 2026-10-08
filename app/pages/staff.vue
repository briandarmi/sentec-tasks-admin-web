<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CloudDownloadIcon, DownloadIcon, FileUpIcon, PencilIcon, PlusIcon, SearchIcon, TriangleAlertIcon, UserRoundMinusIcon, UsersIcon } from '@lucide/vue'
import { useTasksApi } from '~/composables/useTasksApi'
import { useSession } from '~/composables/useSession'
import type { ApiError, EmsAddResult, EmsEmployee, HotelDepartment, HotelMembership, Staff, StaffImportRowResult } from '~/utils/clientFakeApi'

/**
 * Staff at this property. Roles are PER PROPERTY (feat/projects): a person's
 * role, department and create-task permission live on their membership at
 * the selected hotel, and GET /v1/staff narrows each row's `memberships` to
 * that hotel. Name and active state are account-wide.
 *
 * The real API's rules, kept visible here: creation mints `staff` or `leader`
 * ONLY — admin is granted by a second, separate PATCH (the two-step
 * promotion). An email that already exists anywhere is ATTACHED to this
 * property (HTTP 200) rather than created; name and password are then
 * ignored. Deactivation is a PATCH too; nothing is ever deleted.
 *
 * feat/ems-staff-sync: at an EMS-mapped property, people can be added from
 * the Sentec EMS directory, and EMS then OWNS their name, email and
 * membership here — an admin's edit lasts until the next EMS push. A
 * membership EMS could not fully apply (it named a department this property
 * lacks) carries a `syncIssue` the admin resolves by picking a department.
 * Removing a person from one property is DELETE on their membership; the
 * account and their other properties are untouched.
 */
const api = useTasksApi()
const session = useSession()

const rows = ref<Staff[]>([])
const departments = ref<HotelDepartment[]>([])
const isLoading = ref(false)
const isSaving = ref(false)
const errorMessage = ref('')
const formError = ref('')
/** The admin's to-do filter: only members whose membership here carries a sync issue. */
const needsAttentionOnly = ref(false)

const dialogOpen = ref(false)
const editId = ref<string | undefined>()
/** Editing an EMS-linked account: the name field gets the "EMS owns this" hint. */
const editEmsLinked = ref(false)
const formEmail = ref('')
const formName = ref('')
const formPassword = ref('')
const formRole = ref<'staff' | 'leader' | 'admin'>('staff')
const formDepartmentId = ref('')
const formCreateTask = ref(true)
const formActive = ref(true)
/** Create-only: queue the admin promotion as an immediate second request. */
const formPromoteToAdmin = ref(false)
/** Set when the create landed but the queued promotion failed alone. */
const promotionWarning = ref('')
/** What the last create did: a new account, or an existing one attached here. */
const createNotice = ref<{ title: string, message: string } | null>(null)

const hotelName = computed(() => session.activeHotel.value?.name ?? 'this property')
const dialogTitle = computed(() => (editId.value ? 'Edit member' : 'Add member'))
const departmentName = (id: string | null | undefined) => departments.value.find(d => d.id === id)?.departmentName ?? '—'

/** The person's standing at the selected hotel — the only membership the list carries. */
function membershipHere(member: Staff): HotelMembership | null {
  return member.memberships.find(m => m.hotelRef === session.hotelId.value) ?? null
}

/** How many OTHER properties the person can reach — a hint that name/active edits travel. */
function otherPropertyCount(member: Staff) {
  return Math.max(0, member.properties.length - 1)
}

/** The EMS department name Tasks could not match here, if the membership carries one. */
function syncIssueOf(member: Staff) {
  return membershipHere(member)?.syncIssue ?? null
}

const canSave = computed(() => {
  if (isSaving.value || !formName.value.trim()) return false
  if (editId.value) return true
  return formEmail.value.includes('@') && formPassword.value.length >= 10
})

// ── EMS link state ────────────────────────────────────────────────────────────
// Probed ONCE per visit with a one-row page: 422 "not linked" means this
// property has no EMS mapping (no Add-from-EMS button, and removal is open to
// everyone); 503 means it is mapped but EMS is down right now; anything else
// means linked. The page re-mounts on a hotel switch, so the probe runs again.

/** null until probed. */
const emsLinked = ref<boolean | null>(null)
const emsHint = ref('')
let emsProbed = false

async function probeEms() {
  if (emsProbed) return
  emsProbed = true
  try {
    await api.listEmsEmployees({ pageSize: 1 })
    emsLinked.value = true
  }
  catch (e) {
    const err = e as Partial<ApiError>
    if (err.status === 422) {
      emsLinked.value = false
    }
    else if (err.status === 503) {
      // Mapped — the link check passed — but unreachable; the button stays, the dialog will say so verbatim.
      emsLinked.value = true
      emsHint.value = 'EMS unavailable'
    }
    else {
      emsLinked.value = true
    }
  }
}

async function load() {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [staffRows, deptRows] = await Promise.all([
      api.listStaff(needsAttentionOnly.value ? { needsAttention: true } : {}),
      api.listHotelDepartments(),
    ])
    rows.value = staffRows
    departments.value = deptRows
  }
  catch (e) {
    errorMessage.value = (e as Error).message
  }
  finally {
    isLoading.value = false
  }
  void probeEms()
}

function toggleNeedsAttention() {
  needsAttentionOnly.value = !needsAttentionOnly.value
  void load()
}

// ── Remove from this property ─────────────────────────────────────────────────

const removeTarget = ref<Staff | null>(null)
const isRemoving = ref(false)

/**
 * Hidden where the API would refuse anyway: yourself, and — at an EMS-mapped
 * property — anyone EMS manages (EMS would quietly add them back; remove them
 * there). Until the probe answers, EMS-linked rows keep the action hidden too.
 */
function canRemove(member: Staff) {
  if (member.id === session.userId.value) return false
  if (member.emsEmployeeId && emsLinked.value !== false) return false
  return true
}

async function performRemove() {
  const target = removeTarget.value
  if (!target || isRemoving.value) return
  isRemoving.value = true
  errorMessage.value = ''
  try {
    await api.removeStaffFromProperty(target.id)
    removeTarget.value = null
    await load()
  }
  catch (e) {
    // The 409s ("you cannot remove yourself…", "managed by EMS…") in the API's words.
    errorMessage.value = (e as Error).message
    removeTarget.value = null
  }
  finally {
    isRemoving.value = false
  }
}

function openCreate() {
  editId.value = undefined
  formEmail.value = ''
  formName.value = ''
  formPassword.value = ''
  formRole.value = 'staff'
  formDepartmentId.value = ''
  formCreateTask.value = true
  formActive.value = true
  formPromoteToAdmin.value = false
  editEmsLinked.value = false
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(member: Staff) {
  const membership = membershipHere(member)
  editId.value = member.id
  editEmsLinked.value = Boolean(member.emsEmployeeId)
  formEmail.value = member.email
  formName.value = member.name
  formPassword.value = ''
  formRole.value = membership?.role ?? 'staff'
  formDepartmentId.value = membership?.hotelDepartmentId ?? ''
  formCreateTask.value = membership?.createTask ?? false
  formActive.value = member.isActive
  formError.value = ''
  dialogOpen.value = true
}

/**
 * The two 409s POST /v1/staff can answer, in the admin's words. The API's
 * own message stays in the text so nothing is lost in translation.
 */
function createFailureMessage(e: unknown) {
  const err = e as Partial<ApiError> & Error
  const message = err.message ?? 'Request failed'
  if (err.status === 409 || err.code === 'CONFLICT') {
    if (/already belongs/i.test(message)) return `Not attached — ${message}. They are already a member here; change their role from the list instead.`
    if (/deactivated/i.test(message)) return `Not attached — ${message}. An admin at one of their properties must reactivate the account first.`
  }
  return message
}

async function save() {
  if (!canSave.value) return
  isSaving.value = true
  formError.value = ''
  promotionWarning.value = ''
  try {
    if (editId.value) {
      // Email and password are immutable through this route by design. Name
      // and isActive are account-wide; role, department and createTask change
      // ONLY this hotel's membership (the active hotel rides in X-Hotel-Id).
      await api.updateStaff(editId.value, {
        name: formName.value.trim(),
        role: formRole.value,
        hotelDepartmentId: formDepartmentId.value || null,
        createTask: formCreateTask.value,
        isActive: formActive.value,
      })
    }
    else {
      // The API refuses role=admin at creation; promotion is a second request.
      const { data: created, attached } = await api.createStaff({
        email: formEmail.value.trim(),
        name: formName.value.trim(),
        password: formPassword.value,
        role: formRole.value === 'admin' ? 'leader' : formRole.value,
        hotels: session.hotelId.value ? [session.hotelId.value] : [],
        hotelDepartmentId: formDepartmentId.value || null,
        createTask: formCreateTask.value,
      })
      createNotice.value = attached
        ? { title: `Existing account attached to ${hotelName.value}`, message: `${created.name} (${created.email}) already had an account, so it was given access here as ${formRole.value === 'admin' ? 'leader' : formRole.value}. Name and password were left unchanged.` }
        : { title: 'Member created', message: `${created.name} (${created.email}) can sign in to ${hotelName.value} now.` }
      if (formPromoteToAdmin.value) {
        try {
          await api.updateStaff(created.id, { role: 'admin' })
        }
        catch (e) {
          // The account exists; only the promotion failed. Say exactly that.
          promotionWarning.value = `${created.name} was ${attached ? 'attached' : 'created'}, but the admin promotion failed: ${(e as Error).message}. Promote them from Edit.`
        }
      }
    }
    await load()
    dialogOpen.value = false
  }
  catch (e) {
    formError.value = editId.value ? (e as Error).message : createFailureMessage(e)
  }
  finally {
    isSaving.value = false
  }
}

// ── Add from EMS ──────────────────────────────────────────────────────────────
// The property's people as EMS lists them, each annotated with its state
// here. Only `addable` rows can be picked; the add is one request for the
// whole pick, answered per person (created / linked / granted / skipped /
// failed + reason), and the staff list is reloaded afterwards.

const EMS_PAGE_SIZE = 20

const emsOpen = ref(false)
const emsQuery = ref('')
/** The query the current page was fetched with — paging keeps it, a new search resets to page 1. */
const emsAppliedQuery = ref('')
const emsRows = ref<EmsEmployee[]>([])
const emsMeta = ref({ page: 1, pageSize: EMS_PAGE_SIZE, total: 0 })
const emsLoading = ref(false)
const emsSubmitting = ref(false)
const emsError = ref('')
const emsPicked = ref(new Set<string>())
const emsRole = ref<'staff' | 'leader' | 'admin'>('staff')
const emsCreateTask = ref(true)
const emsResults = ref<EmsAddResult[]>([])

const emsPageCount = computed(() => Math.max(1, Math.ceil(emsMeta.value.total / emsMeta.value.pageSize)))
const emsPickedCount = computed(() => emsPicked.value.size)

const EMS_STATE_META: Record<EmsEmployee['state'], { label: string, variant: 'success' | 'default' | 'secondary' | 'warning' }> = {
  added: { label: 'Added', variant: 'success' },
  addable: { label: 'Addable', variant: 'default' },
  no_email: { label: 'No email', variant: 'warning' },
  inactive: { label: 'Inactive', variant: 'secondary' },
}

const EMS_OUTCOME_META: Record<EmsAddResult['outcome'], { label: string, variant: 'success' | 'default' | 'warning' | 'secondary' | 'destructive', hint: string }> = {
  created: { label: 'Created', variant: 'success', hint: 'New account, no password — they sign in by magic link or Google.' },
  linked: { label: 'Linked', variant: 'default', hint: 'An existing account with this email is now tied to the EMS record.' },
  granted: { label: 'Granted', variant: 'warning', hint: 'Already had an account; given access here.' },
  skipped: { label: 'Skipped', variant: 'secondary', hint: 'Already a member here — nothing changed.' },
  failed: { label: 'Failed', variant: 'destructive', hint: 'Nothing changed for this person — see the reason.' },
}

/** The API's reason codes, spelled out; an unknown code is shown as sent. */
const EMS_REASONS: Record<string, string> = {
  not_found_at_this_property: 'EMS does not list this person at this property',
  inactive: 'inactive in EMS',
  no_email: 'no email in EMS',
  invalid_email: 'the EMS email is not a valid address',
  email_taken: 'the email belongs to a different Tasks account',
  email_linked_to_other_employee: 'the email is already linked to another EMS employee',
  error: 'the API could not apply this row',
}

const emsReason = (reason: string | undefined) => (reason ? (EMS_REASONS[reason] ?? reason) : '')
const emsNameById = computed(() => new Map(emsRows.value.map(r => [r.emsEmployeeId, r.name])))

async function loadEmsPage(page: number, query = emsAppliedQuery.value) {
  emsLoading.value = true
  emsError.value = ''
  try {
    const { data, meta } = await api.listEmsEmployees({ q: query || undefined, page, pageSize: EMS_PAGE_SIZE })
    emsRows.value = data
    emsMeta.value = { page: meta.page, pageSize: meta.pageSize || EMS_PAGE_SIZE, total: meta.total }
    emsAppliedQuery.value = query
  }
  catch (e) {
    emsError.value = (e as Error).message
  }
  finally {
    emsLoading.value = false
  }
}

function openEms() {
  emsQuery.value = ''
  emsAppliedQuery.value = ''
  emsRows.value = []
  emsMeta.value = { page: 1, pageSize: EMS_PAGE_SIZE, total: 0 }
  emsPicked.value = new Set()
  emsRole.value = 'staff'
  emsCreateTask.value = true
  emsResults.value = []
  emsError.value = ''
  emsOpen.value = true
  void loadEmsPage(1, '')
}

function searchEms() {
  void loadEmsPage(1, emsQuery.value.trim())
}

function toggleEmsPick(id: string, checked: boolean) {
  const next = new Set(emsPicked.value)
  if (checked) next.add(id)
  else next.delete(id)
  emsPicked.value = next
}

async function submitEms() {
  if (emsSubmitting.value || emsPicked.value.size === 0) return
  emsSubmitting.value = true
  emsError.value = ''
  try {
    emsResults.value = await api.addEmsEmployees({ emsEmployeeIds: [...emsPicked.value], role: emsRole.value, createTask: emsCreateTask.value })
    emsPicked.value = new Set()
    // People landed even when some rows failed — both lists must show them.
    await Promise.all([load(), loadEmsPage(emsMeta.value.page)])
  }
  catch (e) {
    emsError.value = (e as Error).message
  }
  finally {
    emsSubmitting.value = false
  }
}

// ── Roster import ─────────────────────────────────────────────────────────────

const importOpen = ref(false)
const importFile = ref<File | null>(null)
const importBusy = ref<'' | 'csv' | 'xlsx' | 'import'>('')
const importError = ref('')
const importResults = ref<StaffImportRowResult[]>([])
const importMeta = ref<{ total: number, created: number, updated: number, granted: number, failed: number } | null>(null)
const fileInputKey = ref(0)

const OUTCOME_META: Record<StaffImportRowResult['outcome'], { label: string, variant: 'success' | 'default' | 'warning' | 'destructive', hint: string }> = {
  created: { label: 'Created', variant: 'success', hint: 'New account with no password — they sign in by magic link or Google; nothing is emailed.' },
  updated: { label: 'Updated', variant: 'default', hint: 'Existing member here; role, department and create-task refreshed from the file. Admins are never demoted.' },
  granted: { label: 'Granted', variant: 'warning', hint: 'Already at another property; given access here.' },
  failed: { label: 'Failed', variant: 'destructive', hint: 'Nothing changed for this row — see the error.' },
}

function openImport() {
  importFile.value = null
  importError.value = ''
  importResults.value = []
  importMeta.value = null
  fileInputKey.value++
  importOpen.value = true
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  importFile.value = input.files?.[0] ?? null
  importError.value = ''
}

/** Hand a Blob to the browser as a download and release it afterwards. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function downloadTemplate(format: 'csv' | 'xlsx') {
  if (importBusy.value) return
  importBusy.value = format
  importError.value = ''
  try {
    const { blob, filename } = await api.downloadStaffImportTemplate(format)
    saveBlob(blob, filename || `staff-import-template.${format}`)
  }
  catch (e) {
    importError.value = (e as Error).message
  }
  finally {
    importBusy.value = ''
  }
}

async function runImport() {
  const file = importFile.value
  if (!file || importBusy.value) return
  importBusy.value = 'import'
  importError.value = ''
  importResults.value = []
  importMeta.value = null
  try {
    const { data, meta } = await api.importStaff(file)
    importResults.value = data
    importMeta.value = meta
    // Rows landed even when some failed — the list must show them.
    await load()
  }
  catch (e) {
    importError.value = (e as Error).message
  }
  finally {
    importBusy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-8">
    <PageHeader
      title="Staff"
      :description="`Who can work at ${hotelName}. Role, department and create-task are per property; name and active state follow the account everywhere.`"
      :icon="UsersIcon"
    >
      <template #actions>
        <Button size="sm" :variant="needsAttentionOnly ? 'default' : 'secondary'" :aria-pressed="needsAttentionOnly" @click="toggleNeedsAttention">
          <TriangleAlertIcon />
          Needs attention
        </Button>
        <Button size="sm" variant="secondary" @click="openImport">
          <FileUpIcon />
          Import roster
        </Button>
        <!-- Only at an EMS-mapped property; the probe decides. -->
        <Button v-if="emsLinked" size="sm" variant="secondary" @click="openEms">
          <CloudDownloadIcon />
          Add from EMS
        </Button>
        <span v-if="emsHint" class="text-xs text-muted-foreground">{{ emsHint }}</span>
        <Button size="sm" @click="openCreate">
          <PlusIcon />
          Add member
        </Button>
      </template>
    </PageHeader>

    <Alert v-if="errorMessage" variant="destructive">
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription class="space-y-2">
        <p>{{ errorMessage }}</p>
        <Button size="sm" variant="secondary" @click="load">Retry</Button>
      </AlertDescription>
    </Alert>

    <Alert v-if="createNotice">
      <AlertTitle>{{ createNotice.title }}</AlertTitle>
      <AlertDescription>{{ createNotice.message }}</AlertDescription>
    </Alert>

    <Alert v-if="promotionWarning">
      <AlertTitle>Saved, but not promoted</AlertTitle>
      <AlertDescription>{{ promotionWarning }}</AlertDescription>
    </Alert>

    <TableSkeleton v-if="isLoading && rows.length === 0" :rows="5" :columns="5" />

    <Card v-else class="overflow-hidden rounded-xl pt-0">
      <CardContent class="p-0">
        <div class="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role here</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Can raise tasks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="member in rows" :key="member.id" :class="member.isActive ? '' : 'opacity-55'">
                <TableCell>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <p class="font-medium text-foreground">{{ member.name }}</p>
                    <Badge v-if="member.emsEmployeeId" variant="outline" class="text-[10px]" title="Linked to Sentec EMS — EMS owns the name, email and department">EMS</Badge>
                  </div>
                  <p class="text-xs text-muted-foreground">{{ member.email }}</p>
                  <p v-if="otherPropertyCount(member) > 0" class="text-xs text-muted-foreground">
                    Also at {{ otherPropertyCount(member) }} other {{ otherPropertyCount(member) === 1 ? 'property' : 'properties' }}
                  </p>
                </TableCell>
                <TableCell class="capitalize text-foreground">{{ membershipHere(member)?.role ?? 'staff' }}</TableCell>
                <TableCell>
                  <p class="text-foreground">{{ departmentName(membershipHere(member)?.hotelDepartmentId) }}</p>
                  <!-- EMS named a department this property lacks; the admin picks one from Edit and the issue clears. -->
                  <div v-if="syncIssueOf(member)" class="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="warning">
                      <TriangleAlertIcon />
                      Needs attention
                    </Badge>
                    <span class="text-xs text-muted-foreground">EMS says {{ syncIssueOf(member)?.emsDepartmentName }}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge :variant="membershipHere(member)?.createTask ? 'outline' : 'secondary'">{{ membershipHere(member)?.createTask ? 'Yes' : 'No' }}</Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="member.isActive ? 'success' : 'secondary'">{{ member.isActive ? 'Active' : 'Inactive' }}</Badge>
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-2">
                    <Button size="sm" variant="secondary" :aria-label="`Edit ${member.name}`" @click="openEdit(member)">
                      <PencilIcon />
                      Edit
                    </Button>
                    <Button
                      v-if="canRemove(member)"
                      size="sm"
                      variant="secondary"
                      class="text-muted-foreground hover:text-destructive"
                      :aria-label="`Remove ${member.name} from this property`"
                      @click="removeTarget = member"
                    >
                      <UserRoundMinusIcon />
                      Remove
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!isLoading && rows.length === 0">
                <TableCell colspan="6" class="py-10 text-center text-sm text-muted-foreground">
                  {{ needsAttentionOnly ? 'Nothing needs attention — every EMS-synced membership here is clean.' : 'Nobody here yet.' }}
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
          <DialogDescription>
            <template v-if="editId">
              Role, department and create-task apply at {{ hotelName }} only. Name and active state apply to the account at every property.
              Email and password never change through this console.
            </template>
            <template v-else>
              New accounts start as staff or leader; admin is a promotion. If the email already has an account at another property,
              that account is attached to {{ hotelName }} instead — its name and password are left as they are.
            </template>
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="formError" variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="member-name">Name</Label>
              <Input id="member-name" v-model="formName" placeholder="Full name" />
              <p v-if="!editId" class="text-xs text-muted-foreground">Ignored when the email already has an account.</p>
              <p v-else-if="editEmsLinked" class="text-xs text-muted-foreground">Synced from EMS. The next EMS update overwrites this; fix it in EMS.</p>
            </div>
            <div class="space-y-2">
              <Label for="member-email">Email</Label>
              <Input id="member-email" v-model="formEmail" type="email" :disabled="Boolean(editId)" placeholder="name@property.example" />
            </div>
          </div>

          <div v-if="!editId" class="space-y-2">
            <Label for="member-password">Password</Label>
            <Input id="member-password" v-model="formPassword" type="password" autocomplete="new-password" placeholder="At least 10 characters" />
            <p v-if="formPassword && formPassword.length < 10" role="alert" class="text-xs font-medium text-destructive">
              The API requires at least 10 characters.
            </p>
            <p v-else class="text-xs text-muted-foreground">Ignored when the email already has an account.</p>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Role at {{ hotelName }}</Label>
              <Select v-model="formRole">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="leader">Leader</SelectItem>
                  <!-- Promotion path only: the create route refuses admin. -->
                  <SelectItem v-if="editId" value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="space-y-2">
              <Label>Department at {{ hotelName }}</Label>
              <Select :model-value="toSelectValue(formDepartmentId)" @update:model-value="value => formDepartmentId = fromSelectValue(value) ?? ''">
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="No department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="SELECT_EMPTY">No department</SelectItem>
                  <SelectItem v-for="dept in departments" :key="dept.id" :value="dept.id">{{ dept.departmentName }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-create-task" class="cursor-pointer">Can raise tasks here</Label>
              <p class="text-xs text-muted-foreground">The createTask permission at {{ hotelName }} — leaders and admins may always.</p>
            </div>
            <Switch id="member-create-task" v-model="formCreateTask" />
          </div>

          <div v-if="!editId" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-promote" class="cursor-pointer">Promote to admin right after</Label>
              <p class="text-xs text-muted-foreground">
                Two requests: create (or attach) as leader, then promote here. The second can fail alone — the screen will say so.
              </p>
            </div>
            <Switch id="member-promote" v-model="formPromoteToAdmin" />
          </div>

          <div v-if="editId" class="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <Label for="member-active" class="cursor-pointer">Active</Label>
              <p class="text-xs text-muted-foreground">Account-wide. Deactivating signs them out and returns their open tasks at every property to the pools.</p>
            </div>
            <Switch id="member-active" v-model="formActive" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="isSaving" @click="dialogOpen = false">Cancel</Button>
          <Button :disabled="!canSave" @click="save">
            {{ isSaving ? 'Saving…' : 'Save' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="importOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import roster into {{ hotelName }}</DialogTitle>
          <DialogDescription>
            A .csv or .xlsx with columns <span class="font-mono text-xs">email</span> and <span class="font-mono text-xs">name</span> (required),
            <span class="font-mono text-xs">role</span> (staff or leader), <span class="font-mono text-xs">department</span> (by name) and
            <span class="font-mono text-xs">createTask</span> (optional). Every row lands at {{ hotelName }} — the file cannot name a property.
            Up to 1,000 rows, 1 MB.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="importError" variant="destructive">
          <AlertTitle>Import did not run</AlertTitle>
          <AlertDescription>{{ importError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-muted-foreground">Start from a template:</span>
            <Button size="sm" variant="secondary" :disabled="Boolean(importBusy)" @click="downloadTemplate('csv')">
              <DownloadIcon />
              {{ importBusy === 'csv' ? 'Preparing…' : 'CSV' }}
            </Button>
            <Button size="sm" variant="secondary" :disabled="Boolean(importBusy)" @click="downloadTemplate('xlsx')">
              <DownloadIcon />
              {{ importBusy === 'xlsx' ? 'Preparing…' : 'XLSX (with department drop-down)' }}
            </Button>
          </div>

          <div class="space-y-2">
            <Label for="roster-file">Roster file</Label>
            <Input id="roster-file" :key="fileInputKey" type="file" accept=".csv,.xlsx" @change="onFilePicked" />
          </div>

          <div v-if="importMeta" class="space-y-4">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div class="rounded-lg border bg-card px-3 py-2.5">
                <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Rows</p>
                <p class="mt-1 text-xl font-bold tabular-nums text-foreground">{{ importMeta.total }}</p>
              </div>
              <div v-for="outcome in (['created', 'updated', 'granted', 'failed'] as const)" :key="outcome" class="rounded-lg border bg-card px-3 py-2.5">
                <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{{ OUTCOME_META[outcome].label }}</p>
                <p class="mt-1 text-xl font-bold tabular-nums" :class="outcome === 'failed' && importMeta[outcome] ? 'text-destructive' : 'text-foreground'">{{ importMeta[outcome] }}</p>
              </div>
            </div>

            <ul class="space-y-1 text-xs text-muted-foreground">
              <li v-for="outcome in (['created', 'updated', 'granted', 'failed'] as const)" :key="outcome">
                <span class="font-semibold text-foreground">{{ OUTCOME_META[outcome].label }}</span> — {{ OUTCOME_META[outcome].hint }}
              </li>
            </ul>

            <div class="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-16">Line</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="row in importResults" :key="row.line">
                    <TableCell class="tabular-nums text-muted-foreground">{{ row.line }}</TableCell>
                    <TableCell class="text-foreground">{{ row.email || '—' }}</TableCell>
                    <TableCell>
                      <Badge :variant="OUTCOME_META[row.outcome].variant">{{ OUTCOME_META[row.outcome].label }}</Badge>
                    </TableCell>
                    <TableCell>
                      <span v-if="row.outcome === 'failed'" class="text-sm font-medium text-destructive">{{ row.error?.message }}</span>
                      <span v-else class="font-mono text-xs text-muted-foreground">{{ row.staffId }}</span>
                    </TableCell>
                  </TableRow>
                  <TableRow v-if="importResults.length === 0">
                    <TableCell colspan="4" class="py-6 text-center text-sm text-muted-foreground">The file had no data rows.</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="importBusy === 'import'" @click="importOpen = false">{{ importMeta ? 'Close' : 'Cancel' }}</Button>
          <Button :disabled="!importFile || Boolean(importBusy)" @click="runImport">
            <FileUpIcon />
            {{ importBusy === 'import' ? 'Importing…' : importMeta ? 'Import again' : 'Import' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="emsOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add from EMS to {{ hotelName }}</DialogTitle>
          <DialogDescription>
            Everyone Sentec EMS lists at this property. Pick the addable ones; they all get the role and create-task setting below.
            EMS owns their name, email and department from then on. Someone with no email in EMS cannot sign in, so cannot be added.
          </DialogDescription>
        </DialogHeader>

        <Alert v-if="emsError" variant="destructive">
          <AlertTitle>EMS request failed</AlertTitle>
          <AlertDescription>{{ emsError }}</AlertDescription>
        </Alert>

        <div class="space-y-5 py-2">
          <form class="flex items-center gap-2" @submit.prevent="searchEms">
            <Input v-model="emsQuery" placeholder="Search by name, email or EMS id" aria-label="Search EMS employees" />
            <Button type="submit" size="sm" variant="secondary" :disabled="emsLoading">
              <SearchIcon />
              Search
            </Button>
          </form>

          <div class="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-10" />
                  <TableHead>Employee</TableHead>
                  <TableHead>EMS department</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in emsRows" :key="row.emsEmployeeId" :class="row.state === 'addable' ? '' : 'opacity-70'">
                  <TableCell>
                    <!-- Only addable rows can be picked; the others say why not in the State column. -->
                    <Checkbox
                      v-if="row.state === 'addable'"
                      :model-value="emsPicked.has(row.emsEmployeeId)"
                      :aria-label="`Pick ${row.name}`"
                      @update:model-value="checked => toggleEmsPick(row.emsEmployeeId, checked === true)"
                    />
                  </TableCell>
                  <TableCell>
                    <p class="font-medium text-foreground">{{ row.name }}</p>
                    <p class="text-xs text-muted-foreground">{{ row.email ?? 'No email' }} · <span class="font-mono">{{ row.emsEmployeeId }}</span></p>
                  </TableCell>
                  <TableCell>
                    <p class="text-foreground">{{ row.departmentName ?? '—' }}</p>
                    <p v-if="row.departmentName && !row.hotelDepartmentId" class="text-xs text-muted-foreground">No match here — will need attention</p>
                  </TableCell>
                  <TableCell>
                    <Badge :variant="EMS_STATE_META[row.state].variant">{{ EMS_STATE_META[row.state].label }}</Badge>
                  </TableCell>
                </TableRow>
                <TableRow v-if="!emsLoading && emsRows.length === 0">
                  <TableCell colspan="4" class="py-8 text-center text-sm text-muted-foreground">
                    {{ emsError ? 'Nothing to show.' : emsAppliedQuery ? 'No one in EMS matches that search.' : 'EMS lists no one at this property.' }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="emsLoading && emsRows.length === 0">
                  <TableCell colspan="4" class="py-8 text-center text-sm text-muted-foreground">Loading from EMS…</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{{ emsMeta.total }} in EMS · page {{ emsMeta.page }} of {{ emsPageCount }} · {{ emsPickedCount }} picked</span>
            <div class="flex items-center gap-2">
              <Button size="sm" variant="secondary" :disabled="emsLoading || emsMeta.page <= 1" @click="loadEmsPage(emsMeta.page - 1)">Previous</Button>
              <Button size="sm" variant="secondary" :disabled="emsLoading || emsMeta.page >= emsPageCount" @click="loadEmsPage(emsMeta.page + 1)">Next</Button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <Label>Role at {{ hotelName }}</Label>
              <Select v-model="emsRole">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff</SelectItem>
                  <SelectItem value="leader">Leader</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <Label for="ems-create-task" class="cursor-pointer">Can raise tasks here</Label>
                <p class="text-xs text-muted-foreground">Applied to everyone picked.</p>
              </div>
              <Switch id="ems-create-task" v-model="emsCreateTask" />
            </div>
          </div>

          <div v-if="emsResults.length" class="space-y-3">
            <p class="text-sm font-semibold text-foreground">Outcome</p>
            <div class="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="result in emsResults" :key="result.emsEmployeeId">
                    <TableCell>
                      <p class="text-foreground">{{ emsNameById.get(result.emsEmployeeId) ?? result.emsEmployeeId }}</p>
                      <p class="font-mono text-xs text-muted-foreground">{{ result.emsEmployeeId }}</p>
                    </TableCell>
                    <TableCell>
                      <Badge :variant="EMS_OUTCOME_META[result.outcome].variant">{{ EMS_OUTCOME_META[result.outcome].label }}</Badge>
                    </TableCell>
                    <TableCell>
                      <span v-if="result.outcome === 'failed'" class="text-sm font-medium text-destructive">{{ emsReason(result.reason) }}</span>
                      <span v-else class="text-xs text-muted-foreground">{{ EMS_OUTCOME_META[result.outcome].hint }}</span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" :disabled="emsSubmitting" @click="emsOpen = false">{{ emsResults.length ? 'Close' : 'Cancel' }}</Button>
          <Button :disabled="emsSubmitting || emsPickedCount === 0" @click="submitEms">
            <CloudDownloadIcon />
            {{ emsSubmitting ? 'Adding…' : `Add ${emsPickedCount || ''}`.trim() }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="Boolean(removeTarget)" @update:open="value => { if (!value) removeTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {{ removeTarget?.name }} from {{ hotelName }}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their open work here goes back to its pool and their team, helper and offer roles here are cleared.
            The account itself and their other properties are untouched; they can be added again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isRemoving">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive-hover"
            :disabled="isRemoving"
            @click.prevent="performRemove"
          >
            {{ isRemoving ? 'Removing…' : 'Remove from this property' }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
