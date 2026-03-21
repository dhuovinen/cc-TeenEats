# TeenEats Alpha — Test Plan

**Scope**: Pre-MVP alpha build
**Related**: [docs/pre-mvp.md](pre-mvp.md)

---

## Test Layers

| Layer | Tool | Can run in CI | Notes |
|---|---|---|---|
| Backend unit tests | Jest | Yes | Pure functions: ETA, scoring, haversine |
| Backend integration tests | Jest + Supertest | Yes (needs Postgres) | HTTP routes with real DB |
| Backend socket tests | Jest + socket.io-client | Yes (needs Postgres) | Socket.io handshakes + events |
| Dispatcher web | Manual / Playwright (post-alpha) | Partial | Requires browser |
| Driver app | Manual / Detox (post-alpha) | No | Requires device/simulator |

This document covers all layers. Automated tests for the backend are in `apps/backend/src/__tests__/`.
Manual test cases for dispatcher web and driver app are documented below with expected outcomes.

---

## 1. Backend Unit Tests

### 1.1 ETA Service (`services/eta.ts`)

| Test | Input | Expected Output |
|---|---|---|
| Zero distance | Same lat/lng | 0 min |
| Known distance (SF→Oakland, ~13km) | 37.7749,-122.4194 → 37.8044,-122.2712 | ~24 min (±2) |
| Short trip (~1km) | Nearby coords | < 2 min |
| Long trip (SF→LA, ~559km) | 37.7749,-122.4194 → 34.0522,-118.2437 | ~1048 min (±10) |
| Haversine symmetry | A→B == B→A | Distances equal |

### 1.2 Scoring Service (`services/scoring.ts`)

| Test | Scenario | Expected |
|---|---|---|
| No deliveries | Zero rows | `null` overall score |
| 100% acceptance, all on-time, all completed | 5 deliveries | ~100.0 |
| 0% acceptance | All timed out | ~33.3 (acceptance=0, others=100 new-driver default) |
| Mixed acceptance (3/5) | 3 accepted, 2 not | acceptance=60 |
| On-time boundary | actual = estimated * 1.24 | on_time = true |
| On-time boundary | actual = estimated * 1.26 | on_time = false |
| Rolling window | 25 deliveries | Only last 20 counted |

---

## 2. Backend Integration Tests (HTTP Routes)

### 2.1 Auth

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Valid login | POST /auth/login | alex@teeneats.test / password123 | 200, { token, driver } |
| Wrong password | POST /auth/login | alex@teeneats.test / wrong | 401 |
| Unknown email | POST /auth/login | nobody@test.com / x | 401 |
| Missing fields | POST /auth/login | {} | 400 |

### 2.2 Drivers

| Test | Method/Route | Expected |
|---|---|---|
| List drivers (valid key) | GET /drivers | 200, array of 3 drivers |
| List drivers (no key) | GET /drivers | 401 |
| Toggle online (own ID) | PATCH /drivers/:id/status { status: 'online' } | 200, driver.status = 'online' |
| Toggle offline | PATCH /drivers/:id/status { status: 'offline' } | 200, driver.status = 'offline' |
| Toggle another driver's status | PATCH /drivers/:otherId/status | 403 |
| Invalid status value | PATCH /drivers/:id/status { status: 'eating' } | 400 |
| Get own score (no deliveries) | GET /drivers/:id/score | 200, score.overall = null, totalDeliveries = 0 |

### 2.3 Deliveries — Happy Path

| Test | Steps | Expected |
|---|---|---|
| Create delivery | POST /deliveries (dispatcher key) | 201, delivery.status = 'pending' |
| Accept delivery | POST /deliveries/:id/accept (driver token) | 200, status = 'assigned', driver_id set |
| Complete delivery | POST /deliveries/:id/complete (driver token) | 200, status = 'completed' |
| Driver freed after complete | GET /drivers (check status) | driver.status = 'online' |
| Create → accept → location ping | POST /deliveries/:id/location | 200, delivery transitions to 'active' |

### 2.4 Deliveries — Edge Cases

| Test | Scenario | Expected |
|---|---|---|
| Accept already-assigned delivery | Second driver tries to accept | 409 |
| Accept while busy | Driver has active delivery, tries to accept another | 409 |
| Complete someone else's delivery | Wrong driver token | 404 |
| Cancel pending delivery | POST /deliveries/:id/cancel | 200, status = 'cancelled' |
| Cancel already-completed | POST /deliveries/:id/cancel | 404 |
| Create without required fields | POST /deliveries (missing pickup_lat) | 400 |

### 2.5 Settings

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Get settings | GET /settings | (dispatcher key) | 200, { request_timeout_seconds: '60' } |
| Update timeout | PUT /settings | { key: 'request_timeout_seconds', value: '30' } | 200, value = '30' |
| Update timeout (too low) | PUT /settings | { key: ..., value: '4' } | 400 |
| Update timeout (too high) | PUT /settings | { key: ..., value: '3601' } | 400 |
| Update without key | PUT /settings | { value: '30' } | 400 |
| No dispatcher key | GET /settings | (no header) | 401 |

---

## 3. Backend Socket Tests

| Test | Scenario | Expected |
|---|---|---|
| Driver auth (valid token) | emit driver_auth | receive driver_auth_ok |
| Driver auth (invalid token) | emit driver_auth with bad token | receive driver_auth_error |
| Dispatcher auth (valid key) | emit dispatcher_auth | receive dispatcher_auth_ok |
| Dispatcher auth (invalid key) | emit dispatcher_auth with wrong key | receive dispatcher_auth_error |
| delivery_request event | Create delivery while driver is online + connected | Driver socket receives delivery_request |
| request_expired on accept | Driver A accepts → Driver B receives request_expired | delivery_id matches |
| request_expired on timeout | Delivery times out | Driver receives request_expired |
| delivery_state_change | Accept delivery | Dispatcher socket receives delivery_state_change |
| driver_location relay | POST /deliveries/:id/location | Dispatcher socket receives driver_location |
| driver_status_change | PATCH /drivers/:id/status | Dispatcher socket receives driver_status_change |

---

## 4. Manual Test Cases — Dispatcher Web

Run against `http://localhost:3000` with backend running.

| # | Test | Steps | Pass Criteria |
|---|---|---|---|
| DW-01 | Page loads | Open http://localhost:3000 | Header shows "TeenEats Dispatcher", connection indicator shows "Connecting…" then "Connected" |
| DW-02 | Driver roster loads | Wait 2s after load | DRIVERS panel shows Alex, Jordan, Sam with offline dots |
| DW-03 | Empty delivery board | Initial state | Board shows "No deliveries yet" |
| DW-04 | Submit delivery request | Fill form, click Send | Board immediately shows new PENDING entry |
| DW-05 | Timeout fires | No driver online, wait timeout seconds | Board entry changes to TIMED OUT |
| DW-06 | Driver goes online | Driver app: Go Online | Dispatcher DRIVERS panel: dot changes to green in <2s |
| DW-07 | Driver accepts | Driver accepts request | Board: status → ASSIGNED with driver name; driver dot → orange (busy) |
| DW-08 | GPS pin appears | Driver app on active delivery | Map: driver pin appears and moves |
| DW-09 | Delivery completes | Driver taps complete | Board: status → COMPLETED; driver dot → green |
| DW-10 | Cancel pending | Send request, immediately click Cancel | Board: CANCELLED; if driver had modal open it dismisses |
| DW-11 | Settings open | Click ⚙ gear icon | Settings panel modal opens showing current timeout |
| DW-12 | Settings save | Change to 15s, save | Header shows "Timeout: 15s"; next request times out in 15s |
| DW-13 | Settings validation | Enter 3, save | Error: "Must be between 5 and 3600 seconds" |
| DW-14 | Score updates | Complete delivery | Driver's score column shows value (after 1st completion) |

---

## 5. Manual Test Cases — Driver App

Run on iOS Simulator or physical device.

| # | Test | Steps | Pass Criteria |
|---|---|---|---|
| DA-01 | Login valid | alex@teeneats.test / password123 | Navigates to Home screen showing "Hi, Alex" |
| DA-02 | Login invalid | wrong@email.com / x | Error message displayed, stays on login |
| DA-03 | Go online | Tap Go Online | Button changes to "Go Offline"; dispatcher sees green dot |
| DA-04 | Go offline | Tap Go Offline | Button changes to "Go Online"; dispatcher sees grey dot |
| DA-05 | Incoming request modal | Go online, dispatcher sends request | Modal slides up with pickup, dropoff, item, ETA, countdown timer |
| DA-06 | Countdown progress bar | Watch modal | Blue progress bar shrinks to zero as timer counts down |
| DA-07 | Modal auto-dismiss | Wait for timeout to expire | Modal dismisses automatically when timer reaches 0 |
| DA-08 | Accept delivery | Tap Accept Delivery | Modal dismisses; app transitions to Active Delivery screen |
| DA-09 | Active delivery map | On Active Delivery screen | Map shows blue pin (pickup) and red pin (dropoff) |
| DA-10 | Live position on map | Move simulator location | Green "You" pin updates on map |
| DA-11 | GPS hint visible | Active delivery screen | Yellow warning about keeping screen on is visible |
| DA-12 | Complete delivery | Tap Mark as Delivered, confirm | Returns to Home screen; score updates |
| DA-13 | Cancel propagation | Dispatcher cancels active delivery | App shows alert "Delivery cancelled" and returns to Home |
| DA-14 | Score display | After 1+ completions | Home screen shows numeric score with 3 component scores |
| DA-15 | No score state | Fresh account, 0 deliveries | Shows "Complete deliveries to see your score" |
| DA-16 | Sign out | Tap Sign out, confirm | Returns to Login screen |

---

## 6. End-to-End Scenarios

| Scenario | Steps | Pass Criteria |
|---|---|---|
| E2E-01: Full delivery loop | Alex online → dispatcher sends → Alex accepts → GPS tracking → completes | Status transitions: pending→assigned→active→completed visible on both platforms simultaneously |
| E2E-02: Race condition | Jordan + Sam both online, send 1 request, both attempt accept | Exactly one accepted (assigned); other gets request_expired; second accept returns 409 |
| E2E-03: Timeout with online driver | Alex online but doesn't accept | After timeout: TIMED_OUT on board; Alex's acceptance_rate score decreases |
| E2E-04: Timeout config round-trip | Set timeout to 15s, send request, don't accept | Times out in ~15s (not default 60s) |
| E2E-05: Dispatcher cancel mid-delivery | Accept, start delivery, dispatcher cancels | Driver app shows cancellation alert; driver status returns to online |

---

## 7. What's Not Tested (Alpha Exclusions)

| Area | Reason |
|---|---|
| Push notifications (Expo) | Requires APNs/FCM credentials and physical device |
| Google Maps rendering | Requires API key; visual test only |
| Background location | Not implemented (foreground only at alpha) |
| Multi-driver score race conditions | Needs load testing setup |
| Database connection failures | Ops concern, not alpha scope |
| Browser compatibility | Internal tool; Chrome/Safari only for alpha |
| Mobile OS version matrix | Expo Go handles this |
