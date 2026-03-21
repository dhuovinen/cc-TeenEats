# TeenEats Alpha — Test Results

**Date**: 2026-03-21
**Build**: `claude/teeneats-architecture-plan-QN4jr`
**Environment**: Linux, Node.js 22.22.0, PostgreSQL 16

---

## Summary

| Suite | Tests | Passed | Failed | Status |
|---|---|---|---|---|
| Unit: ETA service | 9 | 9 | 0 | ✅ PASS |
| Unit: Scoring logic | 23 | 23 | 0 | ✅ PASS |
| Integration: Auth | 6 | 6 | 0 | ✅ PASS |
| Integration: Drivers | 11 | 11 | 0 | ✅ PASS |
| Integration: Deliveries | 28 | 28 | 0 | ✅ PASS |
| Integration: Settings | 10 | 10 | 0 | ✅ PASS |
| **Total** | **87** | **87** | **0** | **✅ ALL PASS** |

---

## Defects Found and Fixed During Testing

### DEF-001: NUMERIC type returned as string from PostgreSQL

**Discovered in**: Integration test `POST /deliveries › valid request → 201, pending status, estimated_minutes > 0`

**Symptom**: `expect("1.8").toBeGreaterThan(0)` — the `estimated_minutes` field was being serialized as a string by the `pg` library (default behavior for NUMERIC columns to preserve precision).

**Impact**: Any API client reading `estimated_minutes` or `safety_score` as a number would get a string. In practice: the dispatcher web and driver app would both receive `"1.8"` instead of `1.8`, causing comparisons and displays to behave unexpectedly.

**Fix**: Added a global type parser in `src/db.ts`:
```typescript
types.setTypeParser(types.builtins.NUMERIC, (val) => parseFloat(val));
```
All NUMERIC columns (`estimated_minutes`, `safety_score`) now return as JS floats. Float64 precision is sufficient for these values (ETA in minutes, score 0–100).

---

## Automated Test Detail

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

### Integration: Auth (`src/__tests__/integration/auth.test.ts`)

| Test | Result |
|---|---|
| Valid credentials → 200 with token and driver | ✅ |
| Email case-insensitive | ✅ |
| Wrong password → 401 | ✅ |
| Unknown email → 401 | ✅ |
| Missing password → 400 | ✅ |
| Empty body → 400 | ✅ |

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

---

## Not Automated (Manual Tests Required)

See [test-plan.md](test-plan.md) sections 4, 5, and 6 for:

| Area | Reason |
|---|---|
| Dispatcher web UI (DW-01 through DW-14) | Requires browser; Playwright tests are post-alpha scope |
| Driver app screens (DA-01 through DA-16) | Requires iOS/Android simulator; Detox tests are post-alpha scope |
| Socket.io event delivery | Functional validation covered indirectly by integration tests; dedicated socket event tests are post-alpha scope |
| End-to-end scenarios (E2E-01 through E2E-05) | Requires both apps running simultaneously |
| Push notifications | Requires APNs/FCM credentials + physical device |

---

## How to Reproduce

```bash
# Start PostgreSQL and create test database
createdb teeneats_test
psql -d teeneats_test -c "GRANT ALL ON SCHEMA public TO teeneats_test;"

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
```
