# Sentec Tasks — Admin Web

The **admin and operator console** for [Sentec Tasks](../docs/sentec-tasks.md):
property configuration (the property's time zone, departments, staff with the
roster import and the EMS add, teams, locations, SLAs, routing, escalation
policies, operating schedules, task templates, terminology, board columns,
catalog and its categories) and the Sentinel Tech platform screens
(properties and their partner ids, master departments, groups and access,
integration partners, the source-app registry), plus the cross-tenant group
report.

The staff workspace — the queue people actually work from — is a separate app,
[`../sentec-tasks-staff-web`](../sentec-tasks-staff-web). This repository is
**self-contained**: clone it from GitHub on its own, `pnpm install`, and it
builds.

## Two backends, one contract

`pnpm dev` runs this console against the **dev copy of `sentec-tasks-api`** on
AWS Lambda through a local proxy (see [Running against the dev API](#running-against-the-dev-api)).
Tests, static builds (GitHub Pages, CloudFront) and `NUXT_USE_MOCK=1 pnpm dev`
run against the in-browser mock in
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts), which since
2026-09-02 is **wire-faithful to `sentec-tasks-api`** (Go + PostgreSQL, pinned
at `master` commit `c3f52ad` plus the passwordless sign-in branch
`feat/google-and-magic-link-auth` @ `48756a3`, re-aligned 2026-09-16, the
`feat/projects` branch @ `fe5e99d`, reconciled 2026-09-29 against its Go —
per-hotel roles, roster import, task templates, hotel time zone — and the
`refactor/ponytail-audit` tip @ `1ee8c12`, 2026-10-06: escalation policies,
department CRUD with the hotel soft delete, EMS staff sync, offboarding,
partner capabilities and the main/interface surface split): exact
paths, methods, envelope, UUIDs, `X-Hotel-Id` scoping, error codes and message
literals. See the staff workspace's README for the full fidelity story, the
seams a browser mock cannot cross, and the auth model (password, Google
Sign-In and the emailed link all mint one `st_session` cookie) — this file
covers what is admin-specific.

## Getting started

```bash
pnpm install                 # from the workspace root
pnpm dev:tasks-admin         # live, against the dev API: http://localhost:3001
NUXT_USE_MOCK=1 pnpm dev     # the in-browser mock, with the demo accounts below
```

The dev database has no demo accounts: sign in with a real admin or operator
account (the operator is the one the Lambda seeds from
`OPERATOR_BOOTSTRAP_EMAIL` / `_PASSWORD`; property admins are minted by the
operator or sign in with Google once their account exists). The table below
is the **mock's** cast:

| Email                           | Password       | Who they are                                     |
| ------------------------------- | -------------- | ------------------------------------------------ |
| `admin@aston.example`           | `admin123`     | Property admin — configures Aston Simatupang     |
| `operator@sentineltech.example` | `operator123`  | Platform operator — **platform screens only**    |
| `regional@aston.example`        | `regional123`  | Admin at Kuningan + an Aston-wide group grant    |

The login screen offers exactly the accounts the console admits. `staff` and
`leader` accounts are refused at the door — the filter reads the role
`demoLogins()` reports, and
[`tests/console-access.spec.ts`](tests/console-access.spec.ts) pins that proxy
to the real admission rule for every seeded account. The same rule runs after
**every** sign-in path — password, Google, emailed link — since none of them
changes who the account is; the mock's Google account chooser lists the
admissible demo accounts plus the two identities that exercise the callback's
refusals (`no_account`, `email_unverified`).

**An operator reaches no property screen.** Their account carries an empty
hotels claim, so every hotel-scoped route refuses them — that is the real
API's model, not a console choice. They provision tenants, mint each tenant's
first admin (one-time temporary password, shown once), manage groups, grants,
partners and the source-app registry. Property configuration belongs to that
property's own admin.

### Running against the dev API

`pnpm dev` talks to the dev copy of `sentec-tasks-api` (`refactor/ponytail-audit`)
on AWS Lambda **by default** — the Function URL is `DEV_API_URL` in
`nuxt.config.ts`. The API signs you in with a `SameSite=Lax` `st_session`
cookie, so the console and the API must look like one site to the browser:
`nuxt dev` forwards `/v1/*` to the Function URL (`nitro.devProxy`,
`changeOrigin` because a Function URL routes on the Host header) and the
console calls its own dev server. Nothing to configure; `.env.example` lists
the overrides:

```bash
pnpm dev                     # live data, http://localhost:3001
NUXT_USE_MOCK=1 pnpm dev     # the in-browser mock instead (what the tests use)
NUXT_DEV_API_PROXY=http://localhost:8080 pnpm dev   # a local `go run ./cmd/server`
```

- **Browse to `localhost`, never `127.0.0.1`.** They are different sites: the
  cookie will not match and the origin is not on the API's allow-list
  (`CORS_ALLOWED_ORIGINS` = `localhost:3000`, `localhost:3001`). This console
  is pinned to port 3001 (`devServer.port`), the staff workspace to 3000.
  `NUXT_PUBLIC_API_BASE` must be this app's own dev server, never the Function
  URL itself.
- **Google and magic-link sign-in come back through the STAFF dev server on
  port 3000** (`GOOGLE_REDIRECT_URL` and `API_BASE_URL` on the Lambda point
  there), so keep `sentec-tasks-staff-web` running on 3000 for those flows.
  Cookies on `localhost` are shared across ports, so this app on 3001 picks
  the session up afterwards. **Password login needs only this app.**
- **`MAIL_DEV_CONSOLE=true` on the Lambda** means magic links are not
  emailed — they land in the Lambda's CloudWatch log. Use password login if
  you cannot read that log.
- Live, the login screen drops the mock-only furniture (demo-account chips,
  demo inbox, the stand-in Google account chooser) and says it is connected
  to the development API; the flows themselves are the same.
- Static builds (`pnpm generate`: GitHub Pages, CloudFront) have no dev proxy
  and stay on the mock unless `NUXT_PUBLIC_API_BASE` names a same-site API.
- Verified 2026-10-07: `/v1/*` through the dev server reaches the Lambda (a
  wrong password answers the API's own 401 envelope, the served runtime config
  points at `http://localhost:3001`). A full sign-in was not exercised here,
  for want of a dev account on this machine.

```bash
pnpm test          # 159 tests over this repo's own copy of everything
pnpm typecheck     # vue-tsc across app + templates
pnpm build         # static SPA into .output/public
pnpm check:shared  # byte-compares the duplicated files with the staff app
```

## Kept in step by hand

Eleven files are **duplicated** between this app and the staff workspace
(`useSession`, `useTasksApi`, `useCaps`, `useTheme`, `useTenant`, `session.client.ts`,
`clientFakeApi.ts`, `task-ui.ts`, `select-empty.ts`, `sign-in.ts`,
`session-cookie.ts`), plus the seven spec files `mock-api` / `admin-config` /
`staff-flows` / `api-fidelity` / `sign-in` / `session-cookie` / `task-ui` —
each repo tests the copy it ships. `app/composables/useConsoleAccess.ts` is
**not** in that set: it is this app's own rule and has no counterpart.
`pnpm check:shared` fails when the copies differ and skips in a standalone
clone. Since 2026-10-08 it also covers the brand layer, which is identical
across all four Sentec consoles, not only this pair: `tailwind.css`, the
brand marks (`SentinelTechLogo`, `SentinelTechIcon`, `ProductIcon`, `AppLogo`),
`utils/sentec-products.ts` and the design-system page. The one per-app brand
fact, `app/utils/app-product.ts`, is deliberately not checked — it is `null`
here because Sentec Tasks has no entry in the design system's product roster
yet, so the console wears the Sentinel Tech icon mark in Sentinel Blue.

## Screens

Routes are **flat**; the admin/operator boundary lives in
[`app/middleware/auth.global.ts`](app/middleware/auth.global.ts) and the
sidebar's per-group `visible` flag, not in the URL.

| Route                   | Screen               | Needs      |
| ----------------------- | -------------------- | ---------- |
| `/`                     | Overview             | `admin`    |
| `/board`                | Board Columns        | `admin`    |
| `/catalog`              | Catalog              | `admin`    |
| `/categories`           | Categories           | `admin`    |
| `/property`             | Property (time zone) | `admin`    |
| `/departments`          | Departments (+ soft delete) | `admin` |
| `/staff`                | Staff + roster import | `admin`   |
| `/teams`                | Teams                | `admin`    |
| `/locations`            | Locations & types    | `admin`    |
| `/routing`              | Routing Rules        | `admin`    |
| `/slas`                 | SLAs                 | `admin`    |
| `/escalation-policies`  | Escalation Policies  | `admin`    |
| `/operating-schedules`  | Operating Schedules  | `admin`    |
| `/task-templates`       | Task Templates       | `admin`    |
| `/terminology`          | Terminology          | `admin`    |
| `/group-report`         | Group Report         | grant or operator |
| `/platform`             | Operator Home        | `operator` |
| `/properties`           | Properties (+ partner ids) | `operator` |
| `/master-departments`   | Master Departments   | `operator` |
| `/groups`               | Groups & Access      | `operator` |
| `/partners`             | Integration Partners | `operator` |
| `/login`                | The only public route | —         |

## What the contract dictates (and this console honors)

- **Departments are a two-level model.** Sentinel curates a master catalogue
  (operators, or a non-partner service token); an admin can only *enable*
  entries for their hotel. The screen offers exactly that — no free-text
  department names.
- **Departments have a soft delete and a master CRUD** (`refactor/ponytail-audit`,
  2026-10-06). `PATCH /v1/hotel-departments/{id} {isActive}` deactivates a
  department for the hotel — 409 while routing rules or escalation steps
  still route to it, the message naming both counts — or reactivates it,
  422 "department is not available" once the master is retired. Staff, teams
  and schedules keep an inactive department but cannot newly choose one
  (422 "invalid department reference" only when the value changes). Operators
  manage the master catalogue on `/master-departments`: name, code (A–Z 0–9 _,
  ≤ 16, stored upper-case), description ≤ 500, active; delete only while no
  hotel ever used it, else 409 "deactivate it instead". Every hotel row
  mirrors its master's name, code, description and `masterIsActive`.
- **Escalation policies** (`/escalation-policies`). `POST /v1/escalation-policies`
  upserts the policy **and its steps**: a step with an id is updated, one
  without is created, a live step left out is removed — so the editor resends
  every kept step with its id. Up to 10 steps with unique `sort` 0–9; triggers
  RESPONSE_OVERDUE / PERCENT_OF_RESOLUTION (1–100) / RESOLUTION_OVERDUE /
  UNASSIGNED_FOR (≥ 1), in working minutes on the task's schedule; actions
  bumpPriority, reassign (exactly one of staff / team), routeToDepartment (an
  active department); recipients departmentLeaders / admins / assignee at
  most once, teams and staff by target. A new default demotes the old one
  (confirmed, like SLAs); `isActive` is sent explicitly, since omitting it
  means unchanged. SLAs and routing rules carry `escalationPolicyId`: the
  forms always send it — absent would keep the stored link, null clears it, a
  value must be an active policy of this hotel (422). A task resolves its
  policy once at creation: rule → SLA → the hotel's default. The API's worker
  applies the steps; the mock sweeps lazily before every request. Validation
  errors are shown verbatim (`steps[1]: duplicate sort 0`).
- **EMS staff sync.** An operator maps a property to its id at a partner
  (Partner IDs on the Properties screen, `PUT /v1/platform/tenants/{hotelRef}/sync/{partnerId}`;
  409 when another property holds that id). At a property mapped to Sentec
  EMS, the Staff screen's "Add from EMS" browses `GET /v1/ems/employees` (state
  added / addable / no email / inactive, paged and searchable) and adds people
  in bulk with one role and create-task flag; each id answers `created`,
  `linked` (an existing manual account with that email), `granted`, `skipped`
  or `failed` with a reason. EMS owns the name, email and department of linked
  staff (`emsEmployeeId`; the next push overwrites admin edits). A department
  EMS names that the property lacks becomes a `syncIssue` on the membership —
  the "Needs attention" badge and filter (`GET /v1/staff?needsAttention=true`),
  cleared by the next matching push or by setting the department by hand. An
  unmapped property gets 422 "this property is not linked to EMS" and the
  button hides; 503 means EMS is down. Partners carry `capabilities`
  (`staff_sync` lets EMS push employee changes); an unknown value is a 400.
- **Removing and deactivating people.** "Remove from this property"
  (`DELETE /v1/staff/{id}/membership`, 204) returns the person's open tasks
  here to their pools (the Return rule) and clears their helper, offer,
  checklist-step and team roles here; 409 for yourself and for an EMS-linked
  member of an EMS-mapped property ("remove this person in EMS"). Deactivating
  an account (`isActive:false`) now does the same at every property and
  revokes their sessions; the memberships are kept, so reactivation restores
  access.
- **Board columns ride one endpoint.** `PATCH /v1/kanban-board` takes a list of
  edits; a column's status link is immutable once created, and a removal that
  would orphan active work is *skipped with a warning*, never an error. The
  kanban below the table is view + move only: `PATCH /v1/tasks/update` admits
  leaders-of-the-department and services — a tenant admin human is refused, so
  this console offers no field-edit button that could only 403.
- **Routing rules are keyed by their matcher.** `PUT /v1/routing-rules` carries
  at most one of item / category / location type / priority (none = the
  catch-all); repeating a matcher updates that rule in place. No priority
  numbers, no id in the request; deletion is by id.
- **Roles are per property** (`feat/projects`). The Staff payload carries
  `properties` (every hotel the person can reach, grants included) and
  `memberships` (`{hotelRef, role, hotelDepartmentId, createTask}`); there is
  no account-wide `role`, `hotels` or `createTask` any more, on the wire or in
  the JWT. The session, the caps and `adminReach` all read the membership at
  the **selected** hotel, so the switcher changes what an account may do, and
  the page slot is re-keyed on the hotel so a screen never keeps the previous
  hotel's data. A hotel reached only through a group grant has no membership:
  the mock's documented assumption is that the person is plain staff there
  (the regional admin's reach is therefore one hotel, not two).
- **The Staff screen is one hotel's view.** `GET /v1/staff` narrows each row's
  `memberships` to the listed hotel; the table reads role, department and
  create-task from that one membership and hints "also at N other properties"
  from `properties`. In Edit, role / department / create-task PATCH **this**
  hotel's membership (the active hotel rides in `X-Hotel-Id`); name and
  isActive are account-wide, and the dialog says so.
- **Staff creation mints `staff` or `leader` only** — admin is a separate
  PATCH, and the add form can queue that promotion as a second request that can
  fail alone (the screen says so when it does). **An email that already exists
  anywhere is attached, not created**: the API answers 200 instead of 201, the
  account is given a membership at the listed hotels, and name and password
  are ignored — the screen says which happened. The two new 409s ("already
  belongs to one of the listed hotels", "account is deactivated") are shown
  with the API's own words plus what to do. Email and password never change
  through this console. Deactivation is a PATCH; nothing is deleted.
- **Roster import is `POST /v1/staff/import`** (multipart, `.csv` or `.xlsx`;
  columns `email` + `name` required, `role` staff|leader, `department` by
  name, `createTask` optional; 1,000 rows / 32 columns / 1 MB). The hotel
  comes from the header, never from the file. It always answers 200 once the
  file parses, one row per line with an outcome: **created** (new account
  with no password — they sign in by magic link or Google, nothing is
  emailed), **updated** (existing member here; admins are never demoted),
  **granted** (a person from another property given access here), or
  **failed** with the reason. Templates come from
  `GET /v1/staff/import/template?format=csv|xlsx` (a raw file; the `.xlsx`
  has a department drop-down). The mock reads `.csv` only and has no
  workbook writer — a `.xlsx` upload is its 400 "unreadable file" and the
  `.xlsx` template its 422 — where the real API supports both, so the UI
  offers both.
- **Task templates** (`/v1/task-templates`) hold task content plus an
  optional schedule (`DAILY` / `WEEKLY` with weekdays 0 = Sunday / `MONTHLY`
  with a day 1–28, at `timeMinutes` past hotel-local midnight, optional
  `startsOn` / `endsOn`). The API's worker creates the runs. Two scopes live
  side by side — **shared** (admin-made) and **personal** (staff's own
  "Repeat" tasks) — and an admin may edit, pause and archive either. The wire
  model carries no scope field, so the page lists `scope=shared` and
  `scope=personal` separately and tags them, rather than reading `scope=all`.
  `PUT` is a full replace, so Pause/Resume re-sends the row with `isActive`
  flipped; a paused save skips content validation, an active one can 422
  ("content does not resolve") and a duplicate name 409s — both shown
  verbatim. `DELETE` archives; tasks already made stay. When the owner loses
  access or the create-task permission, the worker pauses the template and
  fills `lastError`, which the table shows in red.
- **The property's time zone is `PATCH /v1/tenant`** (admin at the hotel;
  `GET /v1/tenant` for any actor). Every clock time in both consoles is shown
  in it (`useTenant` points the time helpers at it), operating schedules are
  read in it, and every active template's next run moves with it, while
  existing tasks keep their due dates — so the Property screen confirms
  before saving and shows the zone's live local time as a hint. A curated
  list covers the Indonesian zones and the region; anything else is typed as
  an IANA name and checked against the browser's zone database first.
- **Terminology has five keys**: `requester`, `visit`, `location`,
  `department` and, since `feat/projects`, `project` (default "Project").
  There is no `projects` key.
- **Partners have no rotate-secret route.** The secret is returned exactly once
  at registration; revocation IS deactivation (checked per request, no
  caching), and a new secret means a new registration. Partner tokens are
  accepted by the API's *interface* deployment only (dispatch, guest
  attachments, the EMS push); this console's calls go to the *main* one.
- **Group grants are per staff member** (`PUT /v1/staff/{id}/group-grants/{groupId}`),
  operator-only, and expand the holder's hotels claim at their next sign-in.
  There is no grant-listing endpoint — the Groups screen assembles holders from
  the member hotels' staff rows, which carry `groupGrants`.
- **There is no summary or audit endpoint.** The Overview's numbers are the
  task list's own `meta.total` under each filter (fetched with `limit=1`), and
  the audit-trail screen from earlier iterations is gone — the real API keeps
  its audit stream in logs, not behind HTTP.
- **The group report is `GET /v1/groups/{id}/stats`**: authorized for operators
  and grant holders only, all seven statuses zero-filled per property.

## Where the session lives: a cookie, not Web Storage (2026-09-17)

The credential is in a cookie written by the app, through
[`app/utils/session-cookie.ts`](app/utils/session-cookie.ts) (identical in all
four frontends): `SameSite=Strict`, `Secure` when served over https, `Path`
scoped to this app's base URL so a sibling app on the same origin cannot read
it by name, and a `Max-Age` the browser enforces even if the app is never
opened again. Only the secret goes in the cookie — a cookie is capped at 4 KB
and the helper throws rather than truncate a credential.

What this does not buy, said plainly: a cookie written by script cannot be
`HttpOnly`, so a script injected into the page could read it exactly as it
could read localStorage. That protection needs the API to set the cookie,
which these static, cross-origin builds cannot use. See the helper's header.

Here: cookie `sentec-tasks-session` holds the session id the mock stands in
for the API's httpOnly `st_session` with, `Max-Age=43200` like the real one.
It replaced sessionStorage: a cookie is per browser rather than per tab, so a
closed tab no longer ends the shift — the 12-hour clock does, on both the
cookie and the mock's session row. A leftover sessionStorage id is adopted
once and removed. Nothing else is stored; identity and the CSRF token come
from `GET /v1/auth/session` on boot, as before.

## Session expiry: automatic sign-out (2026-09-17)

A session the API no longer accepts is dropped on this device and the user is
sent to `/login`, instead of every screen failing on the same 401 while the
sidebar still shows them signed in.

Two triggers, one landing:

- **A 401 from any request** (`useSession.request`). The `st_session` cookie
  is past its 12-hour window, was revoked by a sign-out elsewhere, or is
  unknown after a server restart. `isSessionInvalidError` in
  [`app/utils/sign-in.ts`](app/utils/sign-in.ts) matches status 401 or code
  `UNAUTHORIZED`. A **403 is not a trigger** — that is a live session lacking
  a permission. The logout call itself is exempt: a 401 there means "already
  gone". Teardown + navigation is single-flight, so a screen's parallel loads
  push `/login` once, and the failing request still throws so the calling
  screen stops its own flow.
- **Boot found a stored session id the server no longer knows**
  (`restore()` → `recover()` fails). The plugin already forgot the id; it now
  also sets `expiredOnRestore`, which the auth middleware reads once to add
  `reason=expired` to the redirect it was already making.

What happens: `expireSession()` runs the same local teardown as `logout`
(identity, session id, every cached payload, the selected property) **without**
`POST /v1/auth/logout`, then `navigateTo('/login?reason=expired&redirect=<page>')`.
The login screen shows the calm "Signed out — your session has ended" notice
(`sessionEndedNotice`; only `expired` is known, the raw value is never
rendered) and, after signing in, returns to `redirect` via the existing
`safeRedirectPath`. There is no client-side expiry pre-check: the cookie is
httpOnly and carries nothing readable, unlike the Butler apps' JWT `exp`.

`useSession.ts`, `sign-in.ts` and `tests/sign-in.spec.ts` are shared with the
sibling app byte-for-byte (`pnpm run check:shared`). Tested:
`tests/sign-in.spec.ts` pins `isSessionInvalidError` and `sessionEndedNotice`;
the redirect itself needs the Nuxt runtime and was checked by typecheck and
build only.

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the shell
and publishes it to GitHub Pages on every push to `feat/overview-compliance`
(or by hand from the Actions tab). The published site is a *project* page,
so it lives under `/sentec-tasks-admin-web/`; the workflow passes that path to Nuxt as
`NUXT_APP_BASE_URL`, and `nuxt.config.ts` reads it into `app.baseURL` — the
repository name is never hardcoded, so a fork publishes under its own name.

Because the app runs entirely against its in-browser mock, nothing else is
needed: no backend, no secret, no environment file. Two host-specific details
are already handled:

- **Deep links.** Pages has no rewrite rule, but it serves `404.html` for any
  unknown path, and the static preset emits `404.html` as a byte-identical copy
  of the shell — so `/sentec-tasks-admin-web/tasks/…` loads the app, which then routes.
- **`_nuxt/` and `_fonts/`.** Jekyll would drop underscore-prefixed
  directories. The Actions deploy never runs Jekyll, and `public/.nojekyll`
  makes that explicit for anyone who switches the source back to a branch.

A local build of the same artifact, for checking before pushing:

```bash
NUXT_APP_BASE_URL=/sentec-tasks-admin-web/ pnpm generate
# then serve .output/public at that sub-path, e.g.
# mkdir -p /tmp/pages && ln -sfn "$PWD/.output/public" /tmp/pages/sentec-tasks-admin-web && npx serve /tmp/pages
```

Deploying from a branch other than the repository's default needs one more
thing: the `github-pages` environment only admits the branches listed in its
deployment-branch policy (Settings → Environments → github-pages), and GitHub
seeds that list with the default branch at the time Pages was enabled. A deploy
from an unlisted branch fails at the deploy step with "not allowed to deploy to
github-pages due to environment protection rules" even though the build passed.
Add the branch there (or via
`gh api -X POST repos/<owner>/<repo>/environments/github-pages/deployment-branch-policies -f name=<branch> -f type=branch`)
and re-run the failed job.

The repository ships its own `pnpm-lock.yaml` so the workflow can run
`pnpm install --frozen-lockfile`. Inside the shared workspace pnpm reads only
the root lockfile and ignores this one; regenerate it after a dependency
change with `pnpm install --lockfile-only --ignore-workspace`. The same section
lives in [`sentec-tasks-staff-web`](../sentec-tasks-staff-web#deploying-to-github-pages).

## Design system

Copied from the staff workspace so the apps stay one product: Nuxt 4 SPA
(`ssr: false`), shadcn-vue (`new-york`, Tabler icons), Tailwind 4, Quicksand,
Sentinel Blue `#27A5F7` via the **Sentinel Tech Design System**'s `--st-*`
scale, dark mode derived from Sentinel Grey. Sidebar shell, wide content,
property switcher in the sidebar header (hidden for operators, who have no
property).

## Not verified yet

- **No browser or component tests** — same environment constraint as the staff
  workspace; `pnpm build` and `pnpm typecheck` pass.
- **Sign-in against the dev API.** The proxy and the API's error envelope were
  checked from this machine (2026-10-07); a real account was not available to
  sign in with, so the screens have been exercised against the mock only.
- **Partner dispatch and the EMS push are modelled, not integrated.** A
  partner token can dispatch and push against the mock; no outside system is
  wired in, and the mock's EMS directory is a seeded stand-in for EMS.
