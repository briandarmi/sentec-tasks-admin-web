# Sentec Tasks — Admin Web

The **admin and operator console** for [Sentec Tasks](../docs/sentec-tasks.md):
property configuration (departments, SLAs, routing, board columns, catalog,
staff, audit), the Sentinel Tech platform screens (properties, groups and
access, integration partners), and the group report.

The staff workspace — the queue people actually work from — is a separate app,
[`../sentec-tasks-staff-web`](../sentec-tasks-staff-web). This repository is
**self-contained**: clone it from GitHub on its own, `pnpm install`, and it
builds. It depends on no sibling repository and no shared package.

Background: [`../docs/Sentec-Tasks-Struktur-Aplikasi.md`](../docs/Sentec-Tasks-Struktur-Aplikasi.md)
(architecture, roles, dispatch flow).

## Getting started

```bash
pnpm install              # from the workspace root
pnpm dev:tasks-admin      # or: pnpm --filter sentec-tasks-admin-web dev
```

Sign in as `admin` / `admin123` for the property screens, or `operator` /
`operator123` for the platform screens as well. The login screen offers these
three accounts, and only these three:

| Username   | Password       | Who they are                                        |
| ---------- | -------------- | --------------------------------------------------- |
| `admin`    | `admin123`     | Property admin — configures the property            |
| `operator` | `operator123`  | Sentinel Tech operator — provisions the platform    |
| `regional` | `regional123`  | Admin at one Aston property, group grant at another  |

The mock also seeds `staff` and `leader`. This console does not offer them,
because it would refuse them: a one-tap button straight to a refusal is worse
than no button. They are still listed on the staff workspace's sign-in screen,
which is where those accounts belong.

The filter reads the role `demoLogins()` reports rather than a hardcoded list of
usernames, so a new seeded admin appears here on its own. That role is one value
per account and therefore only a proxy for the real admission rule —
[`tests/console-access.spec.ts`](tests/console-access.spec.ts) signs in as every
seeded account and asserts the two agree, so a seed that makes them disagree
fails there rather than quietly hiding a working account.

```bash
pnpm test         # 11 tests: who this console admits, and which logins it offers
pnpm typecheck    # vue-tsc across app + templates, including the shared layer
pnpm build        # static SPA into .output/public
```

`pnpm test` runs 81 tests over this repo's own code, so a standalone clone
verifies itself: the mock API contract and the presentation helpers (70, shared
in shape with the staff workspace but tested here against this copy), plus
[`tests/console-access.spec.ts`](tests/console-access.spec.ts) (11). That last
one is specific to this app — the admission rule decides who reaches an admin
console, so it is asserted against the mock's real demo accounts rather than by
reading the seed data, and it pins the sign-in screen's demo list to the same
rule. `adminReach()` and `admitsToConsole()` are plain functions over a session
payload for exactly that reason: no Nuxt runtime needed to test them.

## Kept in step by hand

Eight files are **duplicated** between this app and the staff workspace, and
nothing enforces that they stay identical:

| File                             | Why both apps need it              |
| -------------------------------- | ---------------------------------- |
| `app/composables/useSession.ts`  | Same auth model, same mock         |
| `app/composables/useTasksApi.ts` | Same API contract                  |
| `app/composables/useCaps.ts`     | Same role model                    |
| `app/composables/useTheme.ts`    | Same theme storage key             |
| `app/plugins/session.client.ts`  | Restore before the first route     |
| `app/utils/clientFakeApi.ts`     | Same mock, same seed data          |
| `app/utils/task-ui.ts`           | Same status and SLA presentation   |
| `app/utils/select-empty.ts`      | Reka UI's reserved-empty-value fix |

Plus `tests/mock-api.spec.ts` and `tests/task-ui.spec.ts`, duplicated for a
reason: each repo tests the copy it ships. `app/composables/useConsoleAccess.ts`
is **not** in that set — it is this app's own rule and has no counterpart.

This is the deliberate trade for two repositories that build independently — the
same one the Butler consoles make with their own `clientFakeApi.ts`. A change to
any file above belongs in both apps in the same review. `diff -r` between the two
`app/composables` and `app/utils` directories is the cheap check.

## Screens

Routes are **flat**. This app *is* the admin surface, so an `/admin` prefix would
only repeat what the hostname already says. The admin/operator boundary lives in
[`app/middleware/auth.global.ts`](app/middleware/auth.global.ts) and in the
sidebar's per-group `visible` flag instead of in the URL.

| Route            | Screen               | Needs      |
| ---------------- | -------------------- | ---------- |
| `/`              | Overview             | `admin`    |
| `/departments`   | Departments          | `admin`    |
| `/slas`          | SLAs                 | `admin`    |
| `/routing`       | Routing Rules        | `admin`    |
| `/board`         | Board Columns        | `admin`    |
| `/catalog`       | Catalog              | `admin`    |
| `/staff`         | Staff                | `admin`    |
| `/audit`         | Audit Trail          | `admin`    |
| `/platform`      | Operator Home        | `operator` |
| `/properties`    | Properties           | `operator` |
| `/groups`        | Groups & Access      | `operator` |
| `/partners`      | Integration Partners | `operator` |
| `/group-report`  | Group Report         | `admin`    |
| `/login`         | The only public route | —         |

An operator acts as admin everywhere, so the operator account reaches both
groups. A `staff` or `leader` account is refused at the login screen and its
session dropped, rather than admitted to a console where every route would
refuse it — see [`useConsoleAccess()`](app/composables/useConsoleAccess.ts).

Admission is *account*-wide, not per property: admin at one property is enough to
get in. Because the session otherwise opens on the first property it can reach —
which for an admin who is also staff elsewhere can be the wrong one — both the
gate and the login screen move the active property to one the account
administers, and the sidebar's property switcher offers only those.

Adding a screen means adding its path to `OPERATOR_ROUTES` in the middleware if
it is a platform screen. Forgetting to leaves it reachable by any admin, which
fails visibly rather than silently.

## Roles

Per property: `staff` (own department's queue) → `leader` (also assigns) →
`admin` (also configures — that is this app). `operator` is a platform-level flag
on the user, not a property role, and is the only role that can provision
properties, groups and partners, or issue a group grant.

A **group grant** gives read *and write* across every property in a brand. Only
an operator can grant or revoke one — a property admin cannot, including to
themselves — and every change lands in the audit trail.

**This console grants the `admin` role and nothing else.** `/staff` has no role
picker: adding someone makes them a property admin, and editing an existing
member leaves the role they hold untouched, so an edit cannot quietly promote a
room attendant. The directory still lists staff and team leaders — hiding people
the API returns would serve nobody — and their department, position and active
flag remain editable.

The consequence, stated plainly: **there is no longer any surface in Sentec Tasks
that onboards a staff member or team leader.** The mock seeds them, and the API
still accepts either role, but no screen sends it. That is a deliberate choice,
not an oversight — it needs a home before the product can onboard a property.

The gates in [`useCaps()`](app/composables/useCaps.ts) are
cosmetic: the API enforces the same rules and is the only thing standing between
a caller and the data. They exist so the UI does not offer an action that is
going to come back 403. `useCaps()` still describes all four roles because the
staff workspace admits every one of them.

## Mock API

There is no `sentec-tasks-api` in this workspace, so the app runs against an
in-browser mock:
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts).
State lives in memory and resets on reload — and it is one dataset shared with
the staff workspace, so a property provisioned here is a property the staff app
can reach.

Scope key is `tenantId` — a tenant **is** a property. The product term is
tenant/property because a tenant need not be a hotel; in PostgreSQL this is the
`hotel_id` LIST partition key every main table is partitioned by, so every query
filters on it explicitly rather than sweeping partitions.

Swapping the mock for the real API means replacing the `request()` body in
[`useSession.ts`](app/composables/useSession.ts) with
`$fetch` and a base URL — once, for both apps.

## Design system

Copied wholesale from the Butler consoles so the apps stay visually one product,
and structured like the Butler admin console specifically, so an admin moving
between the two is not relearning the furniture: Nuxt 4 SPA (`ssr: false`),
shadcn-vue (`new-york`, `neutral` base, Tabler icons), Tailwind 4 with the same
token set, Quicksand, `#027BFF` primary. Sidebar shell, wide content, property
switcher in the sidebar header.

## Not verified yet

- **No browser or component tests.** This environment has no working headless
  browser (Chromium is cached but `libnss3` is missing and installing it needs
  root). `pnpm build` and `pnpm typecheck` pass, which covers templates and
  types but not runtime rendering.
- **Partner dispatch is modelled, not integrated.** Status events are queued and
  visible on `/partners`, but nothing delivers them.
