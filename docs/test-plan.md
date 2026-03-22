# TeenEats — Test Plan

**Scope**: Alpha (pre-MVP) + MVP modules
**Related**: [docs/pre-mvp.md](pre-mvp.md) | [docs/mvp-module-plan.md](mvp-module-plan.md)

---

## Test Layers

| Layer | Tool | Can run in CI | Notes |
|---|---|---|---|
| Backend unit tests | Jest | Yes | Pure functions: ETA, scoring, auth tokens |
| Backend integration tests | Jest + Supertest | Yes (needs Postgres) | HTTP routes with real DB |
| Backend socket tests | Jest + socket.io-client | Yes (needs Postgres) | Socket.io handshakes + events |
| Dispatcher web | Manual / Playwright (post-MVP) | Partial | Requires browser |
| Driver app | Manual / Detox (post-MVP) | No | Requires device/simulator |
| Parent web | Manual / Playwright (post-MVP) | Partial | Requires browser |
| Customer app | Manual / Detox (post-MVP) | No | Requires device/simulator |

Automated tests live in `apps/backend/src/__tests__/`.
Manual test cases are documented in sections 4–6.

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

### 1.3 Auth v2 Service (`services/authV2.ts`) — MVP Module 1

#### Password Validation

| Test | Input | Expected |
|---|---|---|
| Valid password | `Secure1password` | `null` (no error) |
| Too short | `Abc1234` (7 chars) | Error: must be 8+ characters |
| No uppercase | `secure1password` | Error: must contain uppercase |
| No number | `SecurePassword` | Error: must contain a number |
| Exactly 8 chars, valid | `Secure1!` | `null` (no error) |
| 7 chars, otherwise valid | `Secur1!` | Error: must be 8+ characters |

#### Email Token Generation

| Test | Expected |
|---|---|
| Returns non-empty token string | token.length > 20 |
| Expires ~24h from now | expires 23–25h in the future |
| Two calls produce unique tokens | token A ≠ token B |

#### Consent Token Generation

| Test | Expected |
|---|---|
| Returns non-empty token | token.length > 20 |
| Expires ~72h from now | expires 71–73h in the future |

#### JWT: issueAccessToken / verifyAccessToken

| Test | Scenario | Expected |
|---|---|---|
| Issues correct sub + role | driver, `user-123` | payload.sub = `user-123`, payload.role = `driver` |
| All four roles encode correctly | driver/customer/parent/admin | Each role round-trips through verify |
| Expired token throws | expiresIn: -1 | `verifyAccessToken` throws |
| Tampered payload throws | Modified base64 payload | `verifyAccessToken` throws |

---

## 2. Backend Integration Tests (HTTP Routes)

### 2.1 Auth v1 — Alpha (`/auth`)

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Valid login | POST /auth/login | alex@teeneats.test / password123 | 200, { token, driver } |
| Email case-insensitive | POST /auth/login | ALEX@TEENEATS.TEST / password123 | 200 |
| Wrong password | POST /auth/login | alex@teeneats.test / wrong | 401 |
| Unknown email | POST /auth/login | nobody@test.com / x | 401 |
| Missing password | POST /auth/login | { email only } | 400 |
| Empty body | POST /auth/login | {} | 400 |

### 2.2 Auth v2 — MVP Module 1 (`/auth/v2`)

#### Driver Registration

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Valid registration | POST /auth/v2/register/driver | All fields valid | 201, userId, _dev tokens |
| Duplicate email | POST /auth/v2/register/driver | Same email again | 409 |
| Weak password — no uppercase | POST /auth/v2/register/driver | password: `lowercase1` | 400, error mentions uppercase |
| Weak password — too short | POST /auth/v2/register/driver | password: `Ab1` | 400, error mentions 8 chars |
| Weak password — no number | POST /auth/v2/register/driver | password: `SecurePass` | 400, error mentions number |
| Under 16 years old | POST /auth/v2/register/driver | DOB: 2015-01-01 | 400, error mentions 16 |
| parent_email same as driver | POST /auth/v2/register/driver | parent_email = email | 400 |
| Missing required field | POST /auth/v2/register/driver | No parent_email | 400 |
| Invalid state code | POST /auth/v2/register/driver | state: `California` | 400 |
| DB records created | POST /auth/v2/register/driver | Valid | driver_profiles + consent_tokens rows exist |

#### Customer Registration

| Test | Method/Route | Expected |
|---|---|---|
| Valid registration | POST /auth/v2/register/customer | 201, userId, emailVerifyToken |
| Duplicate email | POST /auth/v2/register/customer | 409 |
| Weak password | POST /auth/v2/register/customer | 400 |
| Missing full_name | POST /auth/v2/register/customer | 400 |

#### Email Verification

| Test | Method/Route | Expected |
|---|---|---|
| Valid token | POST /auth/v2/verify-email/:token | 200, email_verified = true in DB |
| Token already cleared (re-use) | POST /auth/v2/verify-email/:token | 400 |
| Invalid token | POST /auth/v2/verify-email/bad-value | 400 |

#### Parental Consent

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Missing password/full_name | POST /auth/v2/consent/:token | {} | 400 |
| Weak password | POST /auth/v2/consent/:token | password: `weak` | 400 |
| Valid consent | POST /auth/v2/consent/:token | Valid credentials | 200, accessToken + refreshToken, parent role, driver.consent_approved = true |
| Already-used token | POST /auth/v2/consent/:token | (second call) | 400, error mentions already used |
| Invalid token | POST /auth/v2/consent/bad-token | Valid credentials | 400 |

#### Login (Multi-Role)

| Test | Method/Route | Expected |
|---|---|---|
| Driver login | POST /auth/v2/login | 200, role=driver, includes state/city/status |
| Customer login | POST /auth/v2/login | 200, role=customer |
| Parent login (post-consent) | POST /auth/v2/login | 200, role=parent |
| Wrong password | POST /auth/v2/login | 401 |
| Unknown email | POST /auth/v2/login | 401 |
| Missing fields | POST /auth/v2/login | 400 |
| Deactivated account | POST /auth/v2/login | 403 |
| Password hash not in response | POST /auth/v2/login | password_hash undefined |

#### Token Refresh

| Test | Method/Route | Expected |
|---|---|---|
| Valid refresh token | POST /auth/v2/refresh | 200, new accessToken + refreshToken |
| Old token revoked after rotation | POST /auth/v2/refresh (original token) | 401 |
| Missing refreshToken field | POST /auth/v2/refresh | 400 |

#### /me (Profile)

| Test | Method/Route | Expected |
|---|---|---|
| Driver /me | GET /auth/v2/me | 200, role=driver, includes state/city/status, no password_hash |
| Customer /me | GET /auth/v2/me | 200, role=customer |
| Parent /me | GET /auth/v2/me | 200, role=parent, linked_drivers array |
| No token | GET /auth/v2/me | 401 |
| Expired token | GET /auth/v2/me | 401 |

#### Logout

| Test | Method/Route | Expected |
|---|---|---|
| Logout with valid token | POST /auth/v2/logout | 200 |
| Refresh after logout fails | POST /auth/v2/refresh | 401 |
| Missing refreshToken | POST /auth/v2/logout | 400 |

### 2.3 Drivers (`/drivers`)

| Test | Method/Route | Expected |
|---|---|---|
| List drivers (valid key) | GET /drivers | 200, array of 3 drivers |
| List drivers (no key) | GET /drivers | 401 |
| List drivers (wrong key) | GET /drivers | 401 |
| Toggle online (own ID) | PATCH /drivers/:id/status | 200, driver.status = 'online' |
| Toggle offline | PATCH /drivers/:id/status | 200, driver.status = 'offline' |
| Toggle another driver's status | PATCH /drivers/:otherId/status | 403 |
| Invalid status value | PATCH /drivers/:id/status `{status:'eating'}` | 400 |
| No auth token | PATCH /drivers/:id/status | 401 |
| Expired token | PATCH /drivers/:id/status | 401 |
| Get own score (no deliveries) | GET /drivers/:id/score | 200, score.overall = null, totalDeliveries = 0 |
| Get another driver's score | GET /drivers/:id/score | 403 |

### 2.4 Deliveries — Happy Path (`/deliveries`)

| Test | Steps | Expected |
|---|---|---|
| Empty list on fresh DB | GET /deliveries | 200, deliveries = [] |
| No dispatcher key | GET /deliveries | 401 |
| Create delivery | POST /deliveries | 201, status='pending', estimated_minutes > 0 |
| Reads timeout from settings | POST /deliveries (after settings update) | timeout_seconds matches setting |
| Missing pickup_lat | POST /deliveries | 400 |
| Missing item_description | POST /deliveries | 400 |
| No dispatcher key on create | POST /deliveries | 401 |
| Score records created for online drivers | POST /deliveries | delivery_scores rows exist |
| Accept delivery | POST /deliveries/:id/accept | 200, status='assigned', driver_id set |
| Driver becomes busy after accept | POST /deliveries/:id/accept | driver.status = 'busy' |
| delivery_score.accepted = true | POST /deliveries/:id/accept | DB row accepted = true |
| Complete delivery | POST /deliveries/:id/complete | 200, status='completed' |
| Driver freed after completion | POST /deliveries/:id/complete | driver.status = 'online' |
| Score record updated on completion | POST /deliveries/:id/complete | completed = true, on_time set |
| Driver safety_score updated | POST /deliveries/:id/complete | driver.safety_score not null |
| Location ping | POST /deliveries/:id/location | 200, ok = true |
| First ping transitions assigned → active | POST /deliveries/:id/location | delivery.status = 'active' |
| Location event persisted | POST /deliveries/:id/location | location_events row exists |

### 2.5 Deliveries — Edge Cases

| Test | Scenario | Expected |
|---|---|---|
| Second accept on assigned delivery | Race condition | 409 |
| Busy driver accepts another | Driver has active delivery | 409 |
| Wrong driver completes | Different driver token | 404 |
| Already-completed delivery | Complete again | 404 |
| Cancel pending delivery | POST /deliveries/:id/cancel | 200, status='cancelled' |
| Cancel already-completed | POST /deliveries/:id/cancel | 404 |
| No dispatcher key on cancel | POST /deliveries/:id/cancel | 401 |
| Wrong driver sends location | Different driver token | 403 |
| Missing lat/lng in location ping | POST /deliveries/:id/location | 400 |

### 2.6 Restaurants & Menu (`/restaurants`) — MVP Module 2

#### Public Browse

| Test | Method/Route | Expected |
|---|---|---|
| Empty list initially | GET /restaurants | 200, restaurants = [] |
| Only active restaurants returned | GET /restaurants | Inactive restaurant absent |
| Response shape has required fields | GET /restaurants | id, name, cuisine_type, lat, lng present |
| Restaurant detail with full menu | GET /restaurants/:id | hours, categories, items nested correctly |
| Inactive restaurant | GET /restaurants/:id | 404 |
| Unknown id | GET /restaurants/:id | 404 |
| Unavailable items excluded from detail | GET /restaurants/:id | Item with available=false not in categories[].items |

#### Admin: Restaurant CRUD

| Test | Method/Route | Expected |
|---|---|---|
| Admin creates restaurant | POST /restaurants | 201, active=true, id returned |
| Missing cuisine_type | POST /restaurants | 400 |
| Invalid lat (out of range) | POST /restaurants | 400 |
| Invalid lng | POST /restaurants | 400 |
| Non-admin (driver) | POST /restaurants | 403 |
| No auth | POST /restaurants | 401 |
| Update name | PUT /restaurants/:id | 200, name changed |
| Partial update (one field) | PUT /restaurants/:id | 200, only supplied fields change |
| Unknown restaurant | PUT /restaurants/:id | 404 |
| Non-admin update | PUT /restaurants/:id | 403 |
| Deactivate | DELETE /restaurants/:id | 200, active=false |
| Deactivated not in public list | GET /restaurants after DELETE | id absent |
| Unknown restaurant deactivate | DELETE /restaurants/:id | 404 |

#### Admin: Hours

| Test | Method/Route | Expected |
|---|---|---|
| Set hours → 200, returns array | POST /restaurants/:id/hours | hours array with correct length |
| Replace hours — overwrites previous | POST /restaurants/:id/hours (2nd call) | only new hours returned in GET |
| Invalid day_of_week (7) | POST /restaurants/:id/hours | 400 |
| open_time >= close_time | POST /restaurants/:id/hours | 400 |
| hours not an array | POST /restaurants/:id/hours | 400 |
| Non-admin | POST /restaurants/:id/hours | 403 |

#### Admin: Categories

| Test | Method/Route | Expected |
|---|---|---|
| Add category → 201 | POST /restaurants/:id/categories | category.name + id returned |
| Missing name | POST /restaurants/:id/categories | 400 |
| Update category → 200 | PUT /restaurants/:id/categories/:cid | name updated |
| Update wrong restaurant | PUT /restaurants/:id/categories/:cid | 404 |
| Delete category → 200 | DELETE /restaurants/:id/categories/:cid | deleted=true |
| Delete already-deleted | DELETE /restaurants/:id/categories/:cid | 404 |

#### Admin: Menu Items

| Test | Method/Route | Expected |
|---|---|---|
| Add item → 201 | POST /restaurants/:id/items | name, price_cents, available=true |
| Missing price_cents | POST /restaurants/:id/items | 400 |
| Negative price_cents | POST /restaurants/:id/items | 400 |
| Non-integer price_cents | POST /restaurants/:id/items | 400 |
| Category from different restaurant | POST /restaurants/:id/items | 404 |
| Update item → 200 | PUT /restaurants/menu-items/:id | name, price_cents updated |
| Update unknown item | PUT /restaurants/menu-items/:id | 404 |
| Toggle available=false → 200 | PATCH /restaurants/menu-items/:id/availability | available=false |
| Toggle available=true → 200 | PATCH /restaurants/menu-items/:id/availability | available=true |
| Non-boolean available | PATCH /restaurants/menu-items/:id/availability | 400 |
| Delete item → 200 | DELETE /restaurants/menu-items/:id | deleted=true |
| Delete already-deleted | DELETE /restaurants/menu-items/:id | 404 |
| Non-admin on item routes | POST /restaurants/:id/items | 403 |

### 2.7 Settings (`/settings`)

| Test | Method/Route | Input | Expected |
|---|---|---|---|
| Get settings | GET /settings | (dispatcher key) | 200, { request_timeout_seconds: '60' } |
| No dispatcher key | GET /settings | — | 401 |
| Update timeout | PUT /settings | key + value: '30' | 200, value = '30' |
| Persisted — GET confirms new value | PUT then GET | — | GET returns updated value |
| Timeout below minimum (4) | PUT /settings | value: '4' | 400 |
| Timeout at minimum (5) | PUT /settings | value: '5' | 200 |
| Timeout above maximum (3601) | PUT /settings | value: '3601' | 400 |
| Timeout at maximum (3600) | PUT /settings | value: '3600' | 200 |
| Missing key field | PUT /settings | { value only } | 400 |
| No dispatcher key | PUT /settings | — | 401 |

### 2.7 Order Lifecycle Integration Tests (`orders.test.ts`)

**Module 3 — 39 tests**

#### Place Order (POST /orders)

| # | Test | Role | Input | Expected |
|---|---|---|---|---|
| ORD-01 | Valid order | customer | restaurant_id, items, delivery_address | 201, order.status='placed', total_cents correct |
| ORD-02 | Multi-item total | customer | 2 different items with quantities | 201, total_cents = sum of (price × qty) |
| ORD-03 | Empty items array | customer | items: [] | 400 |
| ORD-04 | Missing delivery_address | customer | no delivery_address | 400 |
| ORD-05 | Invalid menu_item_id | customer | non-existent UUID | 400 — invalid or unavailable |
| ORD-06 | Invalid restaurant_id | customer | non-existent UUID | 404 |
| ORD-07 | Quantity 0 | customer | quantity: 0 | 400 |
| ORD-08 | Driver tries to place | driver | valid body | 403 |
| ORD-09 | Unauthenticated | none | valid body | 401 |

#### Get Order / My Orders (GET /orders)

| # | Test | Role | Input | Expected |
|---|---|---|---|---|
| ORD-10 | Get own order | customer | GET /orders/:id | 200, order + items |
| ORD-11 | Other customer's order | customer2 | GET /orders/:id belonging to customer1 | 403 |
| ORD-12 | My orders list | customer | GET /orders/mine | 200, orders[], restaurant_name present |
| ORD-13 | Non-existent order | customer | GET /orders/00000…0 | 404 |

#### Full Happy Path

| # | Test | Role | Action | Expected |
|---|---|---|---|---|
| ORD-14 | Confirm placed order | admin | POST /orders/:id/confirm | 200, status='confirmed', confirmed_at set |
| ORD-15 | Mark ready for pickup | admin | POST /orders/:id/ready | 200, status='ready_for_pickup', ready_at set |
| ORD-16 | Available orders visible | driver | GET /orders/available | 200, order in list with restaurant_name |
| ORD-17 | Driver accepts | driver | POST /orders/:id/accept | 200, status='assigned', assigned_at set |
| ORD-18 | Delivery session created | — | DB check after accept | delivery_sessions row exists with driver_id |
| ORD-19 | Driver picks up | driver | POST /orders/:id/pickup | 200, status='picked_up', picked_up_at set |
| ORD-20 | Session picked_up_at updated | — | DB check after pickup | delivery_sessions.picked_up_at not null |
| ORD-21 | Driver delivers | driver | POST /orders/:id/deliver (distance_km, duration_minutes) | 200, status='delivered', delivered_at set |
| ORD-22 | Session completion recorded | — | DB check after deliver | completed_at, distance_km=3.5, duration_minutes=12 |

#### State Transition Violations

| # | Test | Expected |
|---|---|---|
| ORD-23 | Confirm already-confirmed | 409 |
| ORD-24 | Mark ready before confirmed | 409 |
| ORD-25 | Accept a placed (not-ready) order | 409 |
| ORD-26 | Pickup before accepting (no driver_id set) | 403 (driver doesn't own unaccepted order) |
| ORD-27 | Deliver before pickup | 409 |

#### Cancellation

| # | Test | Expected |
|---|---|---|
| ORD-28 | Cancel a placed order | 200, status='cancelled', cancel_reason preserved |
| ORD-29 | Cancel after confirmed | 409 — reason includes 'confirmed' |
| ORD-30 | Other customer cancels | 403 |

#### Race Condition

| # | Test | Expected |
|---|---|---|
| ORD-31 | Two drivers accept simultaneously | One gets 200, other gets 409; exactly one driver_id set |

#### Role-based Access Control

| # | Test | Expected |
|---|---|---|
| ORD-32 | Driver cannot confirm | 403 |
| ORD-33 | Customer cannot accept | 403 |
| ORD-34 | Driver cannot view another driver's assigned order | 403 |
| ORD-35 | GET /orders/restaurant/:rid requires admin | 403 for customer |
| ORD-36 | GET /orders/available requires driver | 403 for customer |
| ORD-37 | Unauthenticated → any route | 401 |

#### Admin: Restaurant Orders

| # | Test | Expected |
|---|---|---|
| ORD-38 | List all orders for restaurant | 200, orders[] |
| ORD-39 | Filter by status | 200, all orders in result have matching status |

---

### 2.8 Compliance Engine Tests — MVP Module 4

#### Unit Tests (`unit/compliance.test.ts`) — 44 tests

Pure function tests (no DB/HTTP).

| Group | # Tests | Description |
|---|---|---|
| `isSchoolYear` | 9 | Jan–May school year; Jun–Aug summer; Sep straddles Labor Day; Oct–Dec school year |
| `isSchoolDay` | 5 | Mon–Fri during school year = school day; weekends/summer = non-school |
| `isSchoolNight` | 5 | Sun–Thu during school year = school night; Fri–Sat/summer = non-school night |
| `getWeekStart` | 3 | Week starts Monday; Wednesday → preceding Monday |
| TX (no limits) | 3 | Always allowed: high hours, curfew time, extreme daily values |
| CA | 11 | 4hr school day cap, 239 min allowed, 10pm curfew, before curfew, 5am start, 8hr non-school, 48hr summer cap, midnight-crossing "00:30" curfew edge cases |
| NY | 6 | 28hr school week cap, 4hr daily cap, 10pm school night, midnight non-school, summer uses 48hr cap |
| Result structure | 2 | Correct shape for allowed and blocked results |

#### Integration Tests (`integration/compliance.test.ts`) — 19 tests

| # | Test | Expected |
|---|---|---|
| CMP-01 | TX driver status: no work hours, no caps | 200, allowed=true, all limits null |
| CMP-02 | CA driver status: no work hours | 200, allowed=true |
| CMP-03 | GET /compliance/status requires driver | 403 for customer |
| CMP-04 | Unauthenticated → 401 | 401 |
| CMP-05 | Admin records work minutes | 200, ok=true |
| CMP-06 | Recorded minutes appear in status | daily + weekly updated |
| CMP-07 | Record: missing driver_id | 400 |
| CMP-08 | Record: non-positive minutes | 400 |
| CMP-09 | Record: requires admin | 403 for driver |
| CMP-10 | TX driver accepts after 600 min recorded (no cap) | 200 on order accept |
| CMP-11 | NY driver blocked when at school week cap | 403 on order accept, compliance block |
| CMP-12 | Admin lists all state rules | 200, rules[], TX/CA/NY present |
| CMP-13 | Admin gets CA rule | 200, daily_school_day_minutes=240 |
| CMP-14 | Unknown state rule | 404 |
| CMP-15 | GET /compliance/rules requires admin | 403 for driver |
| CMP-16 | TX rule has null caps | all limits null |
| CMP-17 | Admin lists violations | 200, violations[] |
| CMP-18 | GET /compliance/violations requires admin | 403 for driver |
| CMP-19 | Work time accumulates across two records | daily=150, weekly=150 |

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

## 7. What's Not Tested

| Area | Reason |
|---|---|
| Push notifications (Expo) | Requires APNs/FCM credentials and physical device |
| Google Maps rendering | Requires API key; visual test only |
| Background location | Not implemented (foreground only at alpha) |
| Multi-driver score race conditions | Needs load testing setup |
| Database connection failures | Ops concern, not MVP scope |
| Browser compatibility | Internal tools; Chrome/Safari only |
| Mobile OS version matrix | Expo Go handles this |
| Socket.io event delivery (automated) | Manual validation; Playwright/Detox tests post-MVP |
| Frontend component rendering | Component tests planned for MVP UI modules |
