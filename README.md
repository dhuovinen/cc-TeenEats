# TeenEats Alpha

End-to-end prototype of the TeenEats delivery platform. A dispatcher web app broadcasts delivery requests to driver mobile apps; drivers accept, are tracked live, and mark deliveries complete. Performance scores update in real time on both platforms.

**Scope**: Pre-MVP alpha. See [docs/pre-mvp.md](docs/pre-mvp.md) for full scope, limitations, and milestone definitions.

---

## Repo Structure

```
apps/
  backend/          Node.js + Express + PostgreSQL + Socket.io
  dispatcher-web/   Next.js dispatcher console
  driver-app/       React Native (Expo) driver app
docs/
  pre-mvp.md        Scope, limitations, dev plan
  architecture.md   Full platform architecture
  schema.md         Full DB schema (production target)
  scoring.md        Scoring algorithm spec
```

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (local or Railway)
- Expo CLI: `npm install -g expo-cli`
- iOS Simulator or Android Emulator (or physical device with Expo Go)
- (Optional) Google Maps API key for dispatcher map

---

## Setup

### 1. Install dependencies

```bash
npm install           # installs all workspaces
```

### 2. Backend

```bash
cp apps/backend/.env.example apps/backend/.env
# Edit .env: set DATABASE_URL, JWT_SECRET, DISPATCHER_API_KEY

npm run migrate       # creates tables + default settings
npm run seed          # inserts 3 test driver accounts
npm run backend       # starts on http://localhost:4000
```

### 3. Dispatcher Web

```bash
cp apps/dispatcher-web/.env.example apps/dispatcher-web/.env.local
# Edit .env.local: set NEXT_PUBLIC_DISPATCHER_API_KEY to match backend
# Optionally add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY for live map

npm run dispatcher    # starts on http://localhost:3000
```

### 4. Driver App

```bash
cp apps/driver-app/.env.example apps/driver-app/.env
# For device testing: change localhost to your machine's LAN IP

cd apps/driver-app
expo start
# Press 'i' for iOS simulator, 'a' for Android
```

---

## Demo Script

**Setup**: Backend running, dispatcher web open, simulator/device ready.

### Step 1 — Driver goes online
1. Open the driver app on device/simulator
2. Log in: `alex@teeneats.test` / `password123`
3. Tap **Go Online**
4. In the dispatcher web → DRIVERS panel: Alex's status dot turns green

### Step 2 — Dispatcher sends a delivery request
1. In dispatcher web → NEW DELIVERY panel
2. Select pickup: "McDonald's - 100 Main St"
3. Select dropoff: "123 Oak Ave"
4. Enter item: "Big Mac + large fries"
5. Click **Send to Drivers**
6. Dispatcher board: new entry appears with **PENDING** badge and countdown

### Step 3 — Driver receives and accepts
1. Driver app: incoming request modal slides up with pickup, dropoff, item, ETA, and countdown timer
2. Tap **Accept Delivery**
3. Dispatcher board: status changes to **ASSIGNED**, driver name appears

### Step 4 — Live GPS tracking
1. Driver app transitions to Active Delivery screen with map
2. Driver map pin moves as GPS updates every 5 seconds
3. Dispatcher map: driver pin appears and updates in real time
4. *(In Xcode simulator: Simulator → Features → Location → City Run to simulate movement)*

### Step 5 — Delivery complete
1. Driver taps **Mark as Delivered** → confirm
2. Dispatcher board: status changes to **COMPLETED**
3. Driver returns to Home screen
4. Both screens: performance score updates (after 1+ deliveries)

### Demonstrating timeout
1. Log out driver (go offline)
2. Dispatcher: send a new request
3. Wait — no drivers are online to accept
4. After configured timeout (default 60s): board shows **TIMED OUT**

### Demonstrating cancel
1. Driver online, dispatcher sends request
2. Before driver accepts: dispatcher clicks **Cancel**
3. Driver app: incoming modal disappears

### Demonstrating timeout config
1. Dispatcher web: click ⚙ (gear icon) in header
2. Change timeout to **15** seconds → Save
3. Send a new request → times out in 15 seconds

---

## Test Accounts

| Name | Email | Password |
|---|---|---|
| Alex Rivera | alex@teeneats.test | password123 |
| Jordan Kim | jordan@teeneats.test | password123 |
| Sam Chen | sam@teeneats.test | password123 |

---

## GPS Simulator Setup (Xcode)

To demo live tracking without driving:

1. Start iOS Simulator
2. Open Simulator menu → **Features → Location**
3. Select **City Run** (or **Freeway Drive** for faster movement)
4. The driver app will pick up the simulated coordinates and stream them to the backend

---

## Known Alpha Limitations

See [docs/pre-mvp.md — Known Limitations](docs/pre-mvp.md#known-limitations-full-list) for the full list. Key ones for demo awareness:

- **GPS requires screen on** — if the demo device locks, tracking stops
- **ETA is straight-line only** — real drive time will be longer
- **3 driver accounts** — pre-seeded, no signup
- **No customer app** — dispatcher manually enters pickup/dropoff

---

## Environment Variables

### Backend (`apps/backend/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing driver JWTs (use a long random string) |
| `DISPATCHER_API_KEY` | Key the dispatcher web app sends in `x-dispatcher-key` header |
| `DISPATCHER_ORIGIN` | CORS origin for the dispatcher web app (default: `http://localhost:3000`) |
| `PORT` | Backend port (default: 4000) |

### Dispatcher Web (`apps/dispatcher-web/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Backend URL (default: `http://localhost:4000`) |
| `NEXT_PUBLIC_DISPATCHER_API_KEY` | Must match backend `DISPATCHER_API_KEY` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps JS API key (optional; text fallback shown if absent) |

### Driver App (`apps/driver-app/.env`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_BACKEND_URL` | Backend URL — use LAN IP for physical device testing |
