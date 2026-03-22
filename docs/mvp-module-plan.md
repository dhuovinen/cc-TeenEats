# TeenEats MVP — Module Development Plan

## Branch Strategy

Each module is developed on `mvp/module-XX-name`.
All tests must be green before the module is committed and the next module begins.

---

## Frontend Architecture Principle: Strict UI/Logic Separation

Every frontend app (`dispatcher-web`, `driver-app`, future `parent-web`, `customer-app`) follows the same layer rule:

```
src/
  api/           # HTTP calls only — no UI imports, no React
    client.ts    # Base Axios/fetch client with auth headers, retry logic
    auth.ts      # Auth API calls
    orders.ts    # Order API calls
    [module].ts  # One file per backend module

  store/         # Global state (Zustand) — reads api/, no UI imports
    authStore.ts
    orderStore.ts

  hooks/         # Feature hooks — call store/api, return typed data
    useOrders.ts
    useDrivers.ts

  components/    # PURE UI — props in, callbacks out, NEVER imports api/ or store/
    ui/          # Atoms: Button, Input, Badge, Modal, Card, Spinner
    layout/      # Header, Sidebar, PageShell
    [feature]/   # Composed feature components (still pure UI)

  screens/ (RN) / pages/ (Next.js)
                 # Feature containers — wire hooks + store to components
                 # These are the ONLY files that import both UI and data

  types/
    domain.ts    # Core domain models (Driver, Order, etc.)
    api.ts       # Raw API response shapes
```

**The hard rule**: `components/` never imports from `api/` or `store/`.
Swapping UX = swap `components/` only.

---

## Module Inventory

| # | Module | Key Deliverables | Frontend Changes |
|---|---|---|---|
| 01 | Foundation — Auth | DB schema v2, signup flows (driver+parent+customer), JWT w/ roles, parental consent token | Auth screens (all apps), frontend architecture setup |
| 02 | Restaurant + Menu | Restaurant CRUD, menu items, categories, availability flags | Admin panel (restaurant mgmt), customer-facing browse screen |
| 03 | Order Lifecycle | Customer places order → dispatch → driver accepts → pickup → deliver | Order flow screens (customer + driver), dispatcher board v2 |
| 04 | Compliance Engine | Work-hour tracker, per-state rule engine, hard stops, school schedule | Compliance status UI in driver app + parent dashboard |
| 05 | Safety Scoring v1 | GPS speed events, harsh braking detection, weighted session score, parent alerts | Score breakdown in driver app + parent dashboard |
| 06 | Payouts + Earnings | Stripe Connect onboarding, 70/30 split, session earnings, weekly payout trigger | Earnings screen (driver), payout history (parent) |
| 07 | Parent Dashboard | New Next.js app — live map, session history, safety summary, alert config, consent management | Entire new web app |
| 08 | Customer App | New Expo app — browse restaurants, cart, order placement, live order status | Entire new mobile app |
| 09 | Push Notifications | Expo push tokens, FCM/APNs, notification templates (order assigned, complete, parent alert) | Notification permission + settings in driver + customer apps |
| 10 | Admin Panel | Next.js admin: restaurant onboarding, driver approval queue, manual payout trigger, analytics | Entire new web app |

---

## Module 1: Foundation — Auth & User Management

**Branch**: `mvp/module-01-foundation`

### Backend

#### DB Migration: `002_mvp_schema.sql`

New tables (additive — alpha tables remain):

| Table | Purpose |
|---|---|
| `users` | Base identity: id, email, role, email_verified, created_at |
| `drivers_mvp` | Extends users: DOB, state, status, safety_score, stripe_account_id |
| `parents` | Extends users: linked to one or more drivers |
| `driver_parent_links` | driver_id ↔ parent_id with consent status |
| `customers` | Extends users: display_name |
| `admin_users` | Extends users: permission_level |
| `consent_tokens` | One-time tokens emailed to parent for consent approval |
| `refresh_tokens` | Stored JWT refresh tokens (supports logout/revocation) |

#### Auth Routes

| Method | Route | Actor | Description |
|---|---|---|---|
| POST | /auth/v2/register/driver | Public | Driver signup: creates user + driver record, fires consent email |
| POST | /auth/v2/register/customer | Public | Customer signup: creates user + customer record |
| POST | /auth/v2/consent/:token | Public | Parent clicks link → approves consent, creates parent account |
| POST | /auth/v2/login | Public | Login for all roles; returns access + refresh token |
| POST | /auth/v2/refresh | Public (refresh token) | Returns new access token |
| GET  | /auth/v2/me | Any authenticated | Returns current user profile with role-specific fields |
| POST | /auth/v2/logout | Any authenticated | Revokes refresh token |
| POST | /auth/v2/verify-email/:token | Public | Confirms email address |

#### JWT Payload v2

```json
{
  "sub": "user-uuid",
  "role": "driver" | "customer" | "parent" | "admin",
  "name": "Alex Rivera",
  "iat": 1234567890,
  "exp": 1234567890
}
```

Access token: 15 min
Refresh token: 30 days, stored in DB

### Tests Required (Module 1)

Unit:
- Password validation rules
- Consent token generation and expiry
- JWT role encoding/decoding

Integration:
- Driver registration (full flow + duplicate email)
- Customer registration (full flow + duplicate email)
- Parent consent (valid token, expired token, already-used token)
- Login (all roles, wrong password, unverified email, deactivated)
- Refresh token (valid, expired, revoked)
- `/auth/v2/me` (each role returns correct shape)
- Logout (token revoked, subsequent refresh fails)

### Test Pass Criteria

All 35+ auth integration tests + all pre-existing 87 tests green before proceeding.

### Frontend Architecture Setup

For each frontend app (`dispatcher-web`, future `parent-web`, `customer-app`):

1. Install Zustand for state management
2. Install Axios for HTTP
3. Create `src/api/client.ts` (base client, auth header injection, token refresh interceptor)
4. Create `src/store/authStore.ts` (user, token, login/logout actions)
5. Create `src/components/ui/` folder with reusable atoms (Button, Input, Spinner, Badge)
6. Convert existing page component to use the new architecture pattern

---

## Module 2: Restaurant + Menu Management

**Branch**: `mvp/module-02-restaurants`

### Backend

#### DB Migration: `003_restaurants.sql`

| Table | Purpose |
|---|---|
| `restaurants` | id, name, address, lat, lng, cuisine_type, active, created_by_admin |
| `menu_categories` | id, restaurant_id, name, display_order |
| `menu_items` | id, category_id, name, description, price_cents, available, image_url |
| `restaurant_hours` | id, restaurant_id, day_of_week, open_time, close_time |

#### Routes

| Method | Route | Actor | Description |
|---|---|---|---|
| GET | /restaurants | Customer/Public | List active restaurants |
| GET | /restaurants/:id | Customer/Public | Restaurant detail + menu |
| POST | /admin/restaurants | Admin | Create restaurant |
| PUT | /admin/restaurants/:id | Admin | Update restaurant |
| DELETE | /admin/restaurants/:id | Admin | Deactivate restaurant |
| POST | /admin/restaurants/:id/menu | Admin | Add menu item |
| PUT | /admin/menu-items/:id | Admin | Update menu item |
| DELETE | /admin/menu-items/:id | Admin | Remove menu item |

### Tests

Integration: restaurant CRUD (admin only), public browse, menu management, hours validation

---

## Module 3: Order Lifecycle

**Branch**: `mvp/module-03-orders`

### Backend

#### DB Migration: `004_orders.sql`

Replaces alpha delivery model with full order lifecycle:

| Table | Purpose |
|---|---|
| `orders` | Customer order: id, customer_id, restaurant_id, status, total_cents |
| `order_items` | Line items: order_id, menu_item_id, quantity, price_cents |
| `delivery_sessions` | Replaces `deliveries`: links order to driver, tracking, timing |
| `location_events_v2` | Links to delivery_session_id (extends alpha location_events) |

Order status machine:
```
placed → confirmed (restaurant) → ready_for_pickup → assigned (driver)
       → picked_up → delivered → cancelled
```

### Tests

Integration: full order flow, state transitions, concurrent accept race condition, cancellation at each state

---

## Module 4: Compliance Engine

**Branch**: `mvp/module-04-compliance`

### Backend

#### DB Migration: `005_compliance.sql`

| Table | Purpose |
|---|---|
| `work_sessions` | Daily session records: driver_id, date, state, minutes_worked |
| `compliance_rules` | Per-state rules loaded from config: daily/weekly max hours, curfews |
| `compliance_violations` | Audit log of blocks + near-misses |

#### Service: `compliance.ts`

- `canStartSession(driverId)` — checks daily/weekly cap, curfew
- `canContinueSession(driverId)` — called on each delivery accept
- `recordWorkTime(driverId, minutes)` — updates running totals
- Loads rules from `docs/compliance.md` data

### Tests

Unit: rule evaluation for 3 key states (CA, NY, TX), boundary conditions (at cap, over cap, curfew)
Integration: hard stop on session start when over limit

---

## Module 5: Safety Scoring v1

**Branch**: `mvp/module-05-scoring`

### Backend

Extends existing scoring with sensor data:

#### DB Migration: `006_scoring_v1.sql`

| Table | Purpose |
|---|---|
| `driving_events` | GPS + accelerometer events during active sessions |
| `session_scores` | Per-session score breakdown: base 100, penalties logged |
| `score_history` | Rolling history, weighted average |

#### Service updates

- `processSpeedEvent(sessionId, speedKph)` — detect violations
- `processBrakingEvent(sessionId, gForce)` — detect harsh braking
- `calculateSessionScore(sessionId)` — apply penalty caps, return 0–100

### Tests

Unit: speed violation thresholds, braking thresholds, penalty capping, weighted average

---

## Module 6: Payouts + Earnings

**Branch**: `mvp/module-06-payouts`

### Backend

- Stripe Connect Express onboarding endpoint
- `calculateSessionEarnings(sessionId)` — base pay + performance bonus
- Weekly payout job (or manual trigger from admin)
- Earnings history endpoint

### Tests

Unit: 70/30 split calculation, bonus scaling (score 0–100 → bonus 0–30%)
Integration: Stripe test mode account creation, payout mock

---

## Module 7: Parent Dashboard (New Web App)

**Branch**: `mvp/module-07-parent-dashboard`

New `apps/parent-web/` Next.js application using same architecture pattern.

### Screens

1. Consent approval (public, token-based)
2. Login (parent accounts)
3. Dashboard: driver list + quick status
4. Live session: real-time map, current speed, score
5. Session history: past trips with route replay
6. Safety report: rolling score, event breakdown
7. Alert settings: configurable thresholds

### Tests

Component tests (React Testing Library): each component in isolation
Integration: API calls through mock server

---

## Module 8: Customer App (New Expo App)

**Branch**: `mvp/module-08-customer-app`

New `apps/customer-app/` Expo application.

### Screens

1. Onboarding + registration
2. Restaurant list (with distance, hours, rating)
3. Restaurant detail + menu
4. Cart + checkout
5. Order confirmation + live status
6. Order tracking map (driver location)
7. Order history

---

## Module 9: Push Notifications

**Branch**: `mvp/module-09-notifications`

- Expo push token registration endpoint
- Notification templates: order assigned, picked up, delivered, parent safety alert
- Notification service: `sendPush(userId, template, data)`

### Tests

Unit: template rendering, recipient resolution
Integration: mock Expo push API

---

## Module 10: Admin Panel (New Web App)

**Branch**: `mvp/module-10-admin`

New `apps/admin-web/` Next.js application.

### Screens

1. Login (admin accounts)
2. Driver queue: pending approval, documents, approve/reject
3. Restaurant management: onboard, update, deactivate
4. Manual payout trigger
5. Compliance violations log
6. Basic analytics: deliveries/day, active drivers, revenue

---

## Definition of Done (per module)

- [ ] All new tests pass
- [ ] All pre-existing tests still pass (no regressions)
- [ ] TypeScript compiles with zero errors
- [ ] Test plan doc updated with new cases
- [ ] Test results doc updated
- [ ] Code committed and pushed
