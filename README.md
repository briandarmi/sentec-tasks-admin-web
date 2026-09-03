# Sentec Tasks — Admin Web

The **admin and operator console** for [Sentec Tasks](../docs/sentec-tasks.md):
property configuration (departments, staff, teams, locations, SLAs, routing,
operating schedules, terminology, board columns, catalog and its categories)
and the Sentinel Tech platform screens (properties, groups and access,
integration partners, the source-app registry), plus the cross-tenant group
report.

The staff workspace — the queue people actually work from — is a separate app,
[`../sentec-tasks-staff-web`](../sentec-tasks-staff-web). This repository is
**self-contained**: clone it from GitHub on its own, `pnpm install`, and it
builds.

## The mock is the real API's contract

The app runs against the in-browser mock in
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts), which since
2026-09-02 is **wire-faithful to `sentec-tasks-api`** (Go + PostgreSQL, pinned
at commit `0c8e1bd`): exact paths, methods, envelope, UUIDs, `X-Hotel-Id`
scoping, error codes and message literals. See the staff workspace's README
for the full fidelity story and the seams a browser mock cannot cross —
this file covers what is admin-specific.

## Getting started

```bash
pnpm install              # from the workspace root
pnpm dev:tasks-admin      # or: pnpm --filter sentec-tasks-admin-web dev
```

| Email                           | Password       | Who they are                                     |
| ------------------------------- | -------------- | ------------------------------------------------ |
| `admin@aston.example`           | `admin123`     | Property admin — configures Aston Simatupang     |
| `operator@sentineltech.example` | `operator123`  | Platform operator — **platform screens only**    |
| `regional@aston.example`        | `regional123`  | Admin at Kuningan + an Aston-wide group grant    |

The login screen offers exactly the accounts the console admits. `staff` and
`leader` accounts are refused at the door — the filter reads the role
`demoLogins()` reports, and
[`tests/console-access.spec.ts`](tests/console-access.spec.ts) pins that proxy
to the real admission rule for every seeded account.

**An operator reaches no property screen.** Their account carries an empty
hotels claim, so every hotel-scoped route refuses them — that is the real
API's model, not a console choice. They provision tenants, mint each tenant's
first admin (one-time temporary password, shown once), manage groups, grants,
partners and the source-app registry. Property configuration belongs to that
property's own admin.

```bash
pnpm test          # 108 tests over this repo's own copy of everything
pnpm typecheck     # vue-tsc across app + templates
pnpm build         # static SPA into .output/public
pnpm check:shared  # byte-compares the duplicated files with the staff app
```

## Kept in step by hand

Eight files are **duplicated** between this app and the staff workspace
(`useSession`, `useTasksApi`, `useCaps`, `useTheme`, `session.client.ts`,
`clientFakeApi.ts`, `task-ui.ts`, `select-empty.ts`), plus the five spec files
`mock-api` / `admin-config` / `staff-flows` / `api-fidelity` / `task-ui` —
each repo tests the copy it ships. `app/composables/useConsoleAccess.ts` is
**not** in that set: it is this app's own rule and has no counterpart.
`pnpm check:shared` fails when the copies differ and skips in a standalone
clone.

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
| `/departments`          | Departments          | `admin`    |
| `/staff`                | Staff                | `admin`    |
| `/teams`                | Teams                | `admin`    |
| `/locations`            | Locations & types    | `admin`    |
| `/routing`              | Routing Rules        | `admin`    |
| `/slas`                 | SLAs                 | `admin`    |
| `/operating-schedules`  | Operating Schedules  | `admin`    |
| `/terminology`          | Terminology          | `admin`    |
| `/group-report`         | Group Report         | grant or operator |
| `/platform`             | Operator Home        | `operator` |
| `/properties`           | Properties           | `operator` |
| `/groups`               | Groups & Access      | `operator` |
| `/partners`             | Integration Partners | `operator` |
| `/login`                | The only public route | —         |

## What the contract dictates (and this console honors)

- **Departments are a two-level model.** Sentinel curates a master catalogue
  (service-created); an admin can only *enable* entries for their hotel. The
  screen offers exactly that — no free-text department names.
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
- **Staff creation mints `staff` or `leader` only** — admin is a separate
  PATCH, and the add form can queue that promotion as a second request that can
  fail alone (the screen says so when it does). Email and password never change
  through this console. Deactivation is a PATCH; nothing is deleted.
- **Partners have no rotate-secret route.** The secret is returned exactly once
  at registration; revocation IS deactivation (checked per request, no
  caching), and a new secret means a new registration.
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
- **Partner dispatch is modelled, not integrated.** A partner token can create
  tasks against the mock, but no outside system is actually wired in.
