# TeenEats: Pre-MVP (Alpha) Scope & Plan

The pre-MVP is an "art of the possible" prototype. Its sole purpose is to demonstrate the core technical loop end-to-end: a driver goes online, receives a delivery request in real time, accepts it, is tracked live on a map, and completes the delivery — with a dispatcher web app orchestrating and observing the whole flow. No payments, no customers, no compliance enforcement.

---

## Personas (Alpha)

| Persona | Platform | Description |
|---|---|---|
| **Driver** | Mobile app (iOS/Android) | Teen driver. Goes online, receives and accepts delivery requests, is tracked live, marks deliveries complete. |
| **Dispatcher** | Web app | Operator who submits delivery requests, monitors driver state and location in real time, and manages system settings. |

Personas **not in scope for alpha**: Customer, Guardian. Named now for documentation consistency.

---

## What's In Scope

### Driver Mobile App
- Pre-seeded login (3 test accounts — no signup flow)
- Availability toggle: go online / go offline
- Receive incoming delivery request (push notification + in-app modal)
  - Displays: pickup address, dropoff address, item description, estimated delivery time
  - Action: Accept (timeout-only — no explicit reject button)
- Max 1 active delivery at a time (cannot receive new requests while one is active)
- Active delivery screen: live map showing driver's current position and route
- Mark delivery as completed
- Performance score screen: driver sees their own score and component breakdown

### Dispatcher Web App
- Submit delivery request form: pickup address, dropoff address, item description
- Real-time delivery state board: live status of all requests
- Live map: driver location pin updated in real time during active delivery
- ETA display on active deliveries
- Cancel a request at any point before completion
- Driver roster: all drivers with online/offline status and performance scores
- Settings (gear icon): configurable request timeout duration (in seconds)

### Backend
- JWT auth with pre-seeded driver accounts
- Delivery request lifecycle with state machine (see below)
- Real-time events via WebSocket to both mobile and web clients
- GPS location ingestion from driver app during active delivery
- Performance score calculation and storage
- Settings API (timeout value persisted in DB)

---

## State Machine

```
Delivery Request States:

  [pending]
      │
      ├─── driver accepts (within timeout) ──► [assigned]
      │                                              │
      ├─── timeout expires ──────────────► [timed_out]    driver marks complete ──► [completed]
      │                                              │
      └─── dispatcher cancels ──────────► [cancelled]   dispatcher cancels ──────► [cancelled]
```

**Rules:**
- When a request enters `pending`, it is broadcast to **all online drivers simultaneously**
- First driver to accept wins; the request immediately moves to `assigned` and the notification expires for all other drivers
- If no driver accepts before the timeout, the request moves to `timed_out` (no auto-retry)
- A driver with an active delivery does not receive new request broadcasts
- Timeout duration is read from the Settings table at request creation time

**Driver States:**
```
offline ──► online (available) ──► busy (active delivery) ──► online (available)
         ◄──────────────────────────────────────────────────────────────────────
```

---

## Performance Score (Alpha)

Three equally-weighted components, each scored 0–100, averaged into a single rolling score.

### 1. Acceptance Rate
```
acceptance_rate = accepted_deliveries / total_requests_received
score = acceptance_rate * 100
```
A driver who lets every request time out scores 0. A driver who accepts every one scores 100.

### 2. On-Time Rate
```
estimated_duration = straight_line_distance_meters / assumed_avg_speed_mps
  (assumed_avg_speed = 8.94 m/s = ~20 mph — configurable constant)

on_time = actual_duration <= estimated_duration * 1.25  (25% buffer)
on_time_rate = on_time_deliveries / completed_deliveries
score = on_time_rate * 100
```

### 3. Completion Rate
```
completion_rate = completed_deliveries / accepted_deliveries
score = completion_rate * 100
```
Covers cases where a delivery is cancelled after being accepted (dispatcher-initiated).

### Rolling Score
```
overall_score = (acceptance_score + on_time_score + completion_score) / 3
```
Rolling over last 20 deliveries (or all deliveries if fewer than 20). Displayed as 0–100 with tier label (from [docs/scoring.md](scoring.md)).

New drivers with 0 completions display "No data yet."

---

## ETA Estimation

```
straight_line_km = haversine(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
assumed_speed_kmh = 32  (≈ 20 mph)
estimated_minutes = (straight_line_km / assumed_speed_kmh) * 60
```

Displayed as "Est. X min" on both the dispatcher web app and the driver's active delivery screen.

### Known Limitations of This Approach
- Does not account for roads, traffic, or turns — actual drive time will be longer
- Assumes constant speed from pickup to dropoff, ignoring stops
- 20 mph is a conservative urban estimate; accuracy varies significantly by geography
- No real-time traffic data
- ETA is calculated at request creation time and does not update during delivery

**Post-alpha**: Replace with Google Maps Directions API for real routing and dynamic ETA updates.

---

## Known Limitations (Full List)

These are deliberate scope exclusions for alpha. Each will be addressed in MVP or later phases.

| Limitation | Impact | Resolution Phase |
|---|---|---|
| Foreground GPS only — screen must stay on during delivery | Driver cannot lock phone while delivering | MVP (background location service) |
| ETA is straight-line estimate, not routed | ETA accuracy is low, especially in non-grid cities | MVP (Google Maps Directions API) |
| Pre-seeded accounts only, no signup | Cannot onboard real drivers without manual DB entry | MVP (auth + onboarding flow) |
| No customer app or customer notifications | Recipient has no visibility into their delivery | MVP |
| No restaurant integration | Dispatcher manually enters pickup/dropoff; no real restaurant menu | MVP |
| No payments or earnings tracking | Drivers cannot be compensated through the platform | MVP |
| No parental consent or Guardian oversight | Safety and legal compliance not enforced | MVP |
| No work-hour compliance | State labor law not enforced | MVP |
| No background check or age verification | No vetting of drivers | MVP |
| No sensor-based driving behavior (accelerometer/gyroscope) | Driving safety not monitored | MVP |
| Performance score is time/acceptance proxy only | Does not reflect actual driving quality | MVP (add sensor telemetry) |
| No customer ratings | Driver quality feedback loop incomplete | Beta |
| No in-app chat | No driver ↔ dispatcher communication | Beta |
| Timeout is broadcast-to-all simultaneously | Less efficient than sequential assignment in dense driver markets | Beta |
| 3 test driver accounts | Not scalable for real operations | MVP |
| No surge or dynamic pricing | Flat delivery fee assumptions | Post-MVP |

---

## Tech Stack (Alpha Subset)

| Layer | Technology | Notes |
|---|---|---|
| Driver app | React Native (Expo) | `expo-location` for GPS; Expo Go for dev, EAS Build for device install |
| Dispatcher web | Next.js (TypeScript) | Single-page app with real-time map; no SSR needed but Next.js sets up cleanly for later |
| Backend | Node.js + Express (TypeScript) | REST + WebSocket (Socket.io) |
| Database | PostgreSQL | Subset of full schema; hosted on Railway |
| Real-time | Socket.io | Driver location events, delivery state changes → dispatcher web + driver app |
| Maps (web) | Google Maps JS SDK | Dispatcher live driver tracking map |
| Maps (mobile) | `react-native-maps` | Driver active delivery map |
| Auth | JWT (pre-seeded) | No OAuth, no signup at alpha |
| Hosting | Railway | Backend + PostgreSQL add-on; zero DevOps setup |
| Push notifications | Expo Push Notifications | Incoming delivery request alert to driver |

---

## Database Schema (Alpha Subset)

```sql
-- Pre-seeded driver accounts
drivers (id, name, email, password_hash, status[offline|online|busy], safety_score, created_at)

-- Delivery requests
deliveries (
  id, pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  item_description,
  status [pending|assigned|active|completed|timed_out|cancelled],
  driver_id (nullable),
  timeout_seconds,       -- copied from settings at creation time
  created_at, accepted_at, completed_at, cancelled_at, timed_out_at
)

-- Driver GPS positions during active delivery
location_events (id, driver_id, delivery_id, lat, lng, ts)

-- Delivery performance records (for score calculation)
delivery_scores (id, driver_id, delivery_id, accepted, on_time, completed, created_at)

-- App settings
settings (key TEXT PRIMARY KEY, value TEXT, updated_at)
-- e.g. key='request_timeout_seconds', value='60'
```

---

## Development Plan

### Milestone 0: Project Foundation
- [ ] Monorepo scaffold: `/apps/driver-app`, `/apps/dispatcher-web`, `/apps/backend`
- [ ] Backend: Express + TypeScript + PostgreSQL connection + Socket.io setup
- [ ] Database: alpha schema migrations
- [ ] Seed script: 3 driver accounts + default settings (timeout = 60s)
- [ ] JWT auth middleware

**Done when**: `POST /auth/login` returns a JWT for a seeded driver account.

---

### Milestone 1: Driver Availability
- [ ] Driver app: login screen → home screen with availability toggle
- [ ] Backend: `PATCH /drivers/:id/status` (offline ↔ online)
- [ ] Dispatcher web: driver roster showing online/offline status in real time (Socket.io event on status change)

**Done when**: Dispatcher sees a driver go online/offline within 2 seconds of the driver toggling.

---

### Milestone 2: Delivery Request & State Machine
- [ ] Dispatcher web: submit delivery request form (pickup, dropoff, description)
- [ ] Backend: `POST /deliveries` → creates request, starts timeout countdown, broadcasts to all online non-busy drivers via Socket.io
- [ ] Driver app: incoming request modal (shows addresses, item, ETA) with Accept button
- [ ] Backend: `POST /deliveries/:id/accept` → assigns to first driver, emits state change to dispatcher, invalidates request for other drivers
- [ ] Backend: timeout job (in-process `setTimeout` at alpha) → moves request to `timed_out`, notifies dispatcher
- [ ] Dispatcher web: cancel button → `POST /deliveries/:id/cancel`
- [ ] Dispatcher web: live state board showing all deliveries and current status

**Done when**: Full request lifecycle demonstrated — submit → driver accepts → assigned; and submit → nobody accepts → timed out; and submit → dispatcher cancels.

---

### Milestone 3: Live GPS Tracking
- [ ] Driver app: `expo-location` watchPositionAsync on delivery accept → sends coordinates to backend every 5 seconds
- [ ] Backend: `POST /deliveries/:id/location` → stores event, emits `driver_location` Socket.io event
- [ ] Dispatcher web: Google Maps JS SDK map, driver pin updates in real time during active delivery
- [ ] Driver app: `react-native-maps` map on active delivery screen showing driver's own position

**Done when**: Dispatcher sees driver's map pin move in real time during an active delivery.

---

### Milestone 4: Delivery Completion
- [ ] Driver app: "Mark as Delivered" button on active delivery screen
- [ ] Backend: `POST /deliveries/:id/complete` → sets status to `completed`, calculates delivery_score record, updates driver rolling safety_score
- [ ] Driver app: delivery complete confirmation screen, return to availability toggle
- [ ] Dispatcher web: delivery moves to completed state on status board

**Done when**: Full end-to-end delivery loop works: submit → accept → track → complete.

---

### Milestone 5: Performance Score
- [ ] Backend: score calculation on delivery completion (acceptance rate, on-time rate, completion rate)
- [ ] Driver app: score screen — overall score, three component scores, last 5 deliveries
- [ ] Dispatcher web: driver roster shows each driver's overall score

**Done when**: After 2+ completed deliveries, score is visible and updates correctly on both platforms.

---

### Milestone 6: Dispatcher Settings
- [ ] Dispatcher web: settings panel (gear icon) with timeout duration field (in seconds)
- [ ] Backend: `GET /settings` and `PUT /settings` endpoints
- [ ] Backend: `POST /deliveries` reads timeout from settings at creation time

**Done when**: Dispatcher changes timeout to 30s, submits a request, and it times out at 30s.

---

### Milestone 7: Polish & Demo Prep
- [ ] Error states: what does the driver app show if connection drops? What does the dispatcher show for a timed-out request?
- [ ] GPS simulator setup: Xcode GPX route for demo without driving (document the setup)
- [ ] Limitations page or banner in dispatcher web app (surfacing the known limitations documented above)
- [ ] End-to-end run-through with all 3 driver accounts
- [ ] README with local setup instructions and demo script

**Done when**: A stakeholder can be walked through the full demo without the presenter needing to explain unexpected behavior.

---

## Out of Scope (Explicit Non-Goals for Alpha)

To be completely unambiguous about what will **not** be built:

- Customer-facing app or any customer experience
- Real restaurant menus or restaurant portal
- Any payment, earnings, or payout functionality
- Parental consent, Guardian dashboard, or any minor-specific compliance
- Work-hour enforcement or school schedule blocking
- Sensor-based driving behavior (accelerometer, gyroscope)
- Background location tracking (screen-off)
- User registration or self-service account creation
- Background checks or identity verification
- In-app chat or messaging
- Push notifications beyond incoming delivery request alerts
- Multi-city or geographic restrictions
- Surge pricing or any pricing logic
- Any production deployment, security hardening, or scalability work
