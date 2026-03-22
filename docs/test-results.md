# TeenEats — Test Results

**Last updated**: 2026-03-22
**Branch**: `mvp/module-03-orders` (merged into `claude/teeneats-architecture-plan-QN4jr`)
**Environment**: Linux, Node.js 22.22.0, PostgreSQL 16

---

## Current Summary

| Suite | Tests | Passed | Failed | Module | Status |
|---|---|---|---|---|---|
| Unit: ETA service | 9 | 9 | 0 | Alpha | ✅ PASS |
| Unit: Scoring logic | 23 | 23 | 0 | Alpha | ✅ PASS |
| Unit: Auth v2 service | 15 | 15 | 0 | MVP M1 | ✅ PASS |
| Integration: Auth v1 | 6 | 6 | 0 | Alpha | ✅ PASS |
| Integration: Auth v2 | 40 | 40 | 0 | MVP M1 | ✅ PASS |
| Integration: Drivers | 11 | 11 | 0 | Alpha | ✅ PASS |
| Integration: Deliveries | 28 | 28 | 0 | Alpha | ✅ PASS |
| Integration: Settings | 10 | 10 | 0 | Alpha | ✅ PASS |
| Integration: Restaurants | 45 | 45 | 0 | MVP M2 | ✅ PASS |
| Integration: Orders | 39 | 39 | 0 | MVP M3 | ✅ PASS |
| **Total** | **226** | **226** | **0** | | **✅ ALL PASS** |

---

## Run History

| Date | Branch | Tests | Passed | Notes |
|---|---|---|---|---|
| 2026-03-21 | `claude/teeneats-architecture-plan-QN4jr` | 87 | 87 | Alpha suite complete |
| 2026-03-22 | `mvp/module-01-foundation` | 142 | 142 | MVP Module 1 added (55 new tests) |
| 2026-03-22 | `mvp/module-02-restaurants` | 187 | 187 | MVP Module 2 added (45 new tests) |
| 2026-03-22 | `mvp/module-03-orders` | 226 | 226 | MVP Module 3 added (39 new tests) |

---

## Defects Found and Fixed

### DEF-001: NUMERIC type returned as string from PostgreSQL
**Module**: Alpha
**Discovered in**: Integration test `POST /deliveries › valid request`
**Symptom**: `expect("1.8").toBeGreaterThan(0)` — `estimated_minutes` serialized as string by the `pg` driver.
**Impact**: API clients would receive `"1.8"` instead of `1.8` for numeric fields.
**Fix**: Added global type parser in `src/db.ts` — `NUMERIC` columns now return JS floats.
**Status**: ✅ Fixed

---

## Full Test Detail — Current Run (226 tests)

### Unit: ETA service (`src/__tests__/unit/eta.test.ts`)

| Test | Result |
|---|---|
| haversineKm: zero distance — same coordinates | ✅ |
| haversineKm: symmetry — A→B equals B→A | ✅ |
| haversineKm: SF → Oakland (~13 km) | ✅ |
| haversineKm: short trip — roughly 1 km | ✅ |
| haversineKm: SF → LA (~559 km) | ✅ |
| estimateMinutes: zero distance returns 0 | ✅ |
| estimateMinutes: SF → Oakland — expected ~24 min at 32 km/h | ✅ |
| estimateMinutes: very short trip — less than 2 minutes | ✅ |
| estimateMinutes: result is always non-negative | ✅ |

### Unit: Scoring logic (`src/__tests__/unit/scoring.test.ts`)

| Test | Result |
|---|---|
| Acceptance: no broadcasts → 100 (new driver default) | ✅ |
| Acceptance: all accepted → 100 | ✅ |
| Acceptance: none accepted → 0 | ✅ |
| Acceptance: 3 of 5 accepted → 60 | ✅ |
| Acceptance: rolling window — only 20 most recent count | ✅ |
| On-time: no completions → 100 (no data) | ✅ |
| On-time: all on-time → 100 | ✅ |
| On-time: none on-time → 0 | ✅ |
| On-time: half on-time → 50 | ✅ |
| Boundary: actual = estimated × 1.0 → on time | ✅ |
| Boundary: actual = estimated × 1.24 → on time (within buffer) | ✅ |
| Boundary: actual = estimated × 1.25 → on time (at boundary) | ✅ |
| Boundary: actual = estimated × 1.26 → late (just over buffer) | ✅ |
| Boundary: actual = estimated × 2.0 → late | ✅ |
| Boundary: actual < estimated → on time | ✅ |
| Completion: no accepted deliveries → 100 (no data) | ✅ |
| Completion: all completed → 100 | ✅ |
| Completion: none completed → 0 | ✅ |
| Completion: null completed (pending) not counted | ✅ |
| Overall: perfect score → 100 | ✅ |
| Overall: zero acceptance, others 100 → 66.7 | ✅ |
| Overall: all zeros → 0 | ✅ |
| Overall: mixed realistic scenario → 86.7 | ✅ |

### Unit: Auth v2 service (`src/__tests__/unit/authV2.test.ts`) — MVP Module 1

| Test | Result |
|---|---|
| validatePasswordStrength: valid password → null | ✅ |
| validatePasswordStrength: too short → error | ✅ |
| validatePasswordStrength: no uppercase → error | ✅ |
| validatePasswordStrength: no number → error | ✅ |
| validatePasswordStrength: exactly 8 chars valid → null | ✅ |
| validatePasswordStrength: 7 chars otherwise valid → error | ✅ |
| generateEmailToken: returns non-empty token | ✅ |
| generateEmailToken: expires ~24h from now | ✅ |
| generateEmailToken: two tokens are unique | ✅ |
| generateConsentToken: returns non-empty token | ✅ |
| generateConsentToken: expires ~72h from now | ✅ |
| issueAccessToken: correct sub and role in payload | ✅ |
| issueAccessToken: all four roles encode correctly | ✅ |
| verifyAccessToken: expired token throws | ✅ |
| verifyAccessToken: tampered token throws | ✅ |

### Integration: Auth v1 (`src/__tests__/integration/auth.test.ts`)

| Test | Result |
|---|---|
| Valid credentials → 200 with token and driver | ✅ |
| Email case-insensitive | ✅ |
| Wrong password → 401 | ✅ |
| Unknown email → 401 | ✅ |
| Missing password → 400 | ✅ |
| Empty body → 400 | ✅ |

### Integration: Auth v2 (`src/__tests__/integration/authV2.test.ts`) — MVP Module 1

| Test | Result |
|---|---|
| Register driver: valid → 201 with userId and dev tokens | ✅ |
| Register driver: duplicate email → 409 | ✅ |
| Register driver: weak password (no uppercase) → 400 | ✅ |
| Register driver: weak password (too short) → 400 | ✅ |
| Register driver: weak password (no number) → 400 | ✅ |
| Register driver: under 16 years old → 400 | ✅ |
| Register driver: parent_email same as driver → 400 | ✅ |
| Register driver: missing required field → 400 | ✅ |
| Register driver: invalid state code → 400 | ✅ |
| Register driver: creates driver_profiles + consent_tokens records | ✅ |
| Register customer: valid → 201 | ✅ |
| Register customer: duplicate email → 409 | ✅ |
| Register customer: weak password → 400 | ✅ |
| Register customer: missing full_name → 400 | ✅ |
| Verify email: valid token → 200, email_verified = true | ✅ |
| Verify email: token already cleared → 400 | ✅ |
| Verify email: invalid token → 400 | ✅ |
| Consent: missing password/full_name → 400 | ✅ |
| Consent: weak password → 400 | ✅ |
| Consent: valid → 200, parent account created, driver consent_approved = true | ✅ |
| Consent: already-used token → 400 | ✅ |
| Consent: invalid token → 400 | ✅ |
| Login: driver → 200 with role + driver profile fields | ✅ |
| Login: customer → 200 with role=customer | ✅ |
| Login: parent (post-consent) → 200 with role=parent | ✅ |
| Login: wrong password → 401 | ✅ |
| Login: unknown email → 401 | ✅ |
| Login: missing fields → 400 | ✅ |
| Login: deactivated account → 403 | ✅ |
| Refresh: valid token → 200, new access + refresh tokens | ✅ |
| Refresh: reused (rotated) token → 401 | ✅ |
| Refresh: missing refreshToken → 400 | ✅ |
| /me: driver → includes state, city, status, no password_hash | ✅ |
| /me: customer → role=customer | ✅ |
| /me: parent → includes linked_drivers array | ✅ |
| /me: no token → 401 | ✅ |
| /me: expired token → 401 | ✅ |
| Logout: valid token → 200 | ✅ |
| Logout: subsequent refresh fails → 401 | ✅ |
| Logout: missing refreshToken → 400 | ✅ |

### Integration: Drivers (`src/__tests__/integration/drivers.test.ts`)

| Test | Result |
|---|---|
| GET /drivers: valid key → 200 with all 3 drivers | ✅ |
| GET /drivers: no key → 401 | ✅ |
| GET /drivers: wrong key → 401 | ✅ |
| PATCH status: go online → 200 | ✅ |
| PATCH status: go offline → 200 | ✅ |
| PATCH status: update another driver → 403 | ✅ |
| PATCH status: invalid value → 400 | ✅ |
| PATCH status: no auth token → 401 | ✅ |
| PATCH status: expired token → 401 | ✅ |
| GET score: fresh driver → null overall, 0 deliveries | ✅ |
| GET score: other driver → 403 | ✅ |

### Integration: Deliveries (`src/__tests__/integration/deliveries.test.ts`)

| Test | Result |
|---|---|
| GET /deliveries: empty list on fresh DB | ✅ |
| GET /deliveries: no key → 401 | ✅ |
| POST /deliveries: valid → 201, pending, ETA > 0 | ✅ |
| POST /deliveries: reads timeout from settings | ✅ |
| POST /deliveries: missing pickup_lat → 400 | ✅ |
| POST /deliveries: missing item_description → 400 | ✅ |
| POST /deliveries: no key → 401 | ✅ |
| POST /deliveries: creates broadcast score records for online drivers | ✅ |
| Accept: driver accepts → 200, assigned, driver_id set | ✅ |
| Accept: driver status becomes busy | ✅ |
| Accept: delivery_score accepted = true | ✅ |
| Accept: second accept → 409 (race condition guard) | ✅ |
| Accept: busy driver → 409 | ✅ |
| Accept: no auth → 401 | ✅ |
| Complete: own delivery → 200, completed | ✅ |
| Complete: driver status returns to online | ✅ |
| Complete: score record marked completed + on_time set | ✅ |
| Complete: driver safety_score calculated and stored | ✅ |
| Complete: wrong driver → 404 | ✅ |
| Complete: already-completed → 404 | ✅ |
| Cancel: pending delivery → 200, cancelled | ✅ |
| Cancel: already-completed → 404 | ✅ |
| Cancel: no key → 401 | ✅ |
| Location: valid ping → 200 | ✅ |
| Location: first ping transitions assigned → active | ✅ |
| Location: event persisted to DB | ✅ |
| Location: wrong driver → 403 | ✅ |
| Location: missing lat/lng → 400 | ✅ |

### Integration: Settings (`src/__tests__/integration/settings.test.ts`)

| Test | Result |
|---|---|
| GET /settings: returns default timeout of 60 | ✅ |
| GET /settings: no key → 401 | ✅ |
| PUT /settings: update value → 200 | ✅ |
| PUT /settings: persisted — GET confirms new value | ✅ |
| PUT /settings: value 4 (below min) → 400 | ✅ |
| PUT /settings: value 5 (at min) → 200 | ✅ |
| PUT /settings: value 3601 (above max) → 400 | ✅ |
| PUT /settings: value 3600 (at max) → 200 | ✅ |
| PUT /settings: missing key → 400 | ✅ |
| PUT /settings: no dispatcher key → 401 | ✅ |

### Integration: Restaurants (`src/__tests__/integration/restaurants.test.ts`) — MVP Module 2

| Test | Result |
|---|---|
| GET /restaurants: empty list initially | ✅ |
| GET /restaurants: returns only active restaurants | ✅ |
| GET /restaurants: response shape has expected fields | ✅ |
| GET /restaurants/:id: returns restaurant with hours + categories + items | ✅ |
| GET /restaurants/:id: inactive restaurant → 404 | ✅ |
| GET /restaurants/:id: unknown id → 404 | ✅ |
| GET /restaurants/:id: unavailable items excluded from detail view | ✅ |
| POST /restaurants: admin creates restaurant → 201 | ✅ |
| POST /restaurants: missing required field (cuisine_type) → 400 | ✅ |
| POST /restaurants: invalid lat (out of range) → 400 | ✅ |
| POST /restaurants: invalid lng → 400 | ✅ |
| POST /restaurants: non-admin (driver) → 403 | ✅ |
| POST /restaurants: no auth → 401 | ✅ |
| PUT /restaurants/:id: update name → 200, name changed | ✅ |
| PUT /restaurants/:id: partial update — only supplied fields change | ✅ |
| PUT /restaurants/:id: unknown restaurant → 404 | ✅ |
| PUT /restaurants/:id: non-admin → 403 | ✅ |
| DELETE /restaurants/:id: deactivate → 200, active=false | ✅ |
| DELETE /restaurants/:id: deactivated not in public list | ✅ |
| DELETE /restaurants/:id: unknown restaurant → 404 | ✅ |
| POST hours: set hours → 200, returns hours array | ✅ |
| POST hours: replace hours — second call overwrites first | ✅ |
| POST hours: invalid day_of_week (7) → 400 | ✅ |
| POST hours: open_time >= close_time → 400 | ✅ |
| POST hours: hours is not an array → 400 | ✅ |
| POST hours: non-admin → 403 | ✅ |
| POST categories: add category → 201 | ✅ |
| POST categories: missing name → 400 | ✅ |
| PUT categories: update → 200, name updated | ✅ |
| PUT categories: wrong restaurant → 404 | ✅ |
| DELETE categories: → 200, deleted=true | ✅ |
| DELETE categories: already-deleted → 404 | ✅ |
| POST items: add item → 201 | ✅ |
| POST items: missing price_cents → 400 | ✅ |
| POST items: negative price_cents → 400 | ✅ |
| POST items: non-integer price_cents → 400 | ✅ |
| POST items: category from different restaurant → 404 | ✅ |
| PUT menu-items/:id: update → 200 | ✅ |
| PUT menu-items/:id: unknown item → 404 | ✅ |
| PATCH availability: available=false → 200 | ✅ |
| PATCH availability: available=true → 200 | ✅ |
| PATCH availability: non-boolean → 400 | ✅ |
| DELETE menu-items/:id: → 200, deleted=true | ✅ |
| DELETE menu-items/:id: already-deleted → 404 | ✅ |
| POST items: non-admin → 403 | ✅ |

---

### Integration: Orders (`src/__tests__/integration/orders.test.ts`) — MVP Module 3

| Test | Result |
|---|---|
| customer can place a valid order | ✅ |
| calculates total_cents correctly for multi-item order | ✅ |
| rejects order with no items | ✅ |
| rejects order missing delivery_address | ✅ |
| rejects order with invalid menu_item_id | ✅ |
| rejects order with invalid restaurant_id | ✅ |
| rejects order with invalid quantity (0) | ✅ |
| requires customer role | ✅ |
| rejects unauthenticated request | ✅ |
| customer can get their own order | ✅ |
| customer cannot get another customer's order | ✅ |
| GET /orders/mine returns customer's orders | ✅ |
| returns 404 for non-existent order | ✅ |
| admin can confirm a placed order | ✅ |
| admin can mark confirmed order as ready_for_pickup | ✅ |
| driver can see available orders | ✅ |
| driver can accept a ready_for_pickup order | ✅ |
| delivery session is created on accept | ✅ |
| driver can mark order as picked_up | ✅ |
| delivery session picked_up_at is updated | ✅ |
| driver can mark order as delivered | ✅ |
| delivery session completed_at, distance_km, duration_minutes are recorded | ✅ |
| cannot confirm an already-confirmed order | ✅ |
| cannot mark ready before confirmed | ✅ |
| cannot accept a placed (not ready) order | ✅ |
| cannot pickup before accepting (driver does not own unaccepted order → 403) | ✅ |
| cannot deliver before pickup | ✅ |
| customer can cancel a placed order | ✅ |
| customer cannot cancel an already-confirmed order | ✅ |
| customer cannot cancel another customer's order | ✅ |
| only one driver can accept the same order (race condition) | ✅ |
| driver cannot confirm an order | ✅ |
| customer cannot accept an order | ✅ |
| driver cannot view another driver's assigned order directly | ✅ |
| GET /orders/restaurant/:rid requires admin | ✅ |
| GET /orders/available requires driver | ✅ |
| unauthenticated request to any route returns 401 | ✅ |
| admin can list all orders for a restaurant | ✅ |
| can filter by status | ✅ |

---

## Not Automated (Manual Tests Required)

See [test-plan.md](test-plan.md) sections 4, 5, and 6 for:

| Area | Reason |
|---|---|
| Dispatcher web UI (DW-01 through DW-14) | Requires browser; Playwright tests post-MVP |
| Driver app screens (DA-01 through DA-16) | Requires iOS/Android simulator; Detox tests post-MVP |
| Socket.io event delivery | Dedicated socket tests post-MVP |
| End-to-end scenarios (E2E-01 through E2E-05) | Requires both apps running simultaneously |
| Push notifications | Requires APNs/FCM credentials + physical device |

---

## How to Reproduce

```bash
# Prerequisites: PostgreSQL 16 running

# Create test database (first time only)
sudo -u postgres createdb teeneats_test
sudo -u postgres psql -d teeneats_test -c \
  "CREATE USER teeneats_test WITH PASSWORD 'testpass'; \
   GRANT ALL ON DATABASE teeneats_test TO teeneats_test; \
   GRANT ALL ON SCHEMA public TO teeneats_test;"

# Run all tests
cd apps/backend
DATABASE_URL="postgresql://teeneats_test:testpass@localhost:5432/teeneats_test" \
JWT_SECRET=test-secret \
DISPATCHER_API_KEY=dispatcher-secret-key \
npm test

# Unit tests only (no DB required)
npm run test:unit

# Integration tests only
npm run test:integration

# Specific module
npm test -- --testPathPattern=authV2
```
