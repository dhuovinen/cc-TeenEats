# TeenEats: Architecture & MVP Plan

## Overview

TeenEats is a youth workforce platform built around food delivery. Teen drivers (16–19) earn money while parents get full oversight and the platform enforces safe, legal work behavior. The architecture must handle real-time GPS + sensor telemetry, regulatory compliance, parental consent flows, and financial payouts — all with minor-specific legal constraints baked in from day one.

---

## Tech Stack

### Mobile (Driver App + Customer App)
**React Native (Expo managed workflow)**
- Single codebase for iOS + Android
- Expo SDK for accelerometer, gyroscope, GPS, and push notifications without native modules
- Expo Go for rapid prototyping; EAS Build for production
- Trade-off accepted: slightly worse raw sensor performance vs native, acceptable at MVP scale

### Backend
**Node.js + Express (TypeScript)**
- Async-friendly for WebSocket/event-driven flows
- TypeScript for type safety
- CPU-heavy safety scoring isolated in a separate worker process

### Database
- **PostgreSQL** — primary relational data store (users, orders, sessions, compliance records)
- **Redis** — session cache, real-time leaderboard, rate limiting, pub/sub for live tracking
- Schema: see [docs/schema.md](docs/schema.md)

### Real-time
**Supabase Realtime** (PostgreSQL NOTIFY + WebSockets)
- Real-time GPS tracking and parent dashboard live updates
- Removes need to manage a separate WebSocket server at MVP
- Designed to fall back to self-hosted if scale demands it

### Hosting
- **MVP**: Railway — zero DevOps overhead, deploy from GitHub, managed PostgreSQL + Redis add-ons
- **Post-MVP**: AWS ECS/Fargate — migrate when traffic and operational maturity justify it

### Maps & Routing
**Google Maps Platform**
- Directions API for routing
- Distance Matrix for ETA estimation
- Geocoding for address resolution

### Payments
**Stripe Connect (Express accounts)**
- Driver payouts via Stripe Connect; handles 1099 generation and bank transfers
- Parental co-signature required for minor accounts

### Push Notifications
**Expo Push Notifications** (wraps FCM + APNs)
- Single API for iOS and Android; no separate FCM/APNs setup at MVP

### Driving Behavior Sensors
| Sensor | Use |
|---|---|
| GPS | Speed violations, route deviation |
| Accelerometer | Harsh braking, rapid acceleration |
| Gyroscope | Cornering, phone orientation |
| Microphone | Distracted driving detection (post-MVP) |

---

## Service Architecture

**Decision: Modular Monolith first, microservices later.**

A monolith with clear internal module boundaries is the right call before product-market fit. Premature microservices add deployment complexity, network latency, and distributed tracing overhead. Module boundaries are structured so extraction into standalone services is straightforward when scale demands it.

### Internal Modules

| Module | Responsibility |
|---|---|
| `auth` | JWT issuance/refresh, parental consent tokens, KYC-lite |
| `orders` | Order lifecycle: created → assigned → picked up → delivered |
| `tracking` | Ingest GPS + sensor events during active delivery sessions |
| `scoring` | Calculate safety scores from driving events, persist results |
| `compliance` | Enforce work-hour limits per state law, school schedule blocks |
| `payouts` | Stripe Connect payouts, 70/30 split calculation, payout history |
| `notifications` | Expo push, email (SendGrid), SMS (Twilio) |
| `parent-oversight` | Aggregate driver data for parent dashboard: reports, alerts, consent |
| `admin` | Restaurant onboarding, driver review queue, operational analytics |

### Real-time Tracking Data Flow

```
Driver phone sensors
  → batch every 5s
  → POST /tracking/events
  → Redis pub/sub
  → Supabase Realtime channel
  → Parent dashboard WebSocket subscription (live map)
  → Scoring worker (async batch processing)
```

---

## MVP Definition — Single City Launch

The MVP proves that teens can safely earn money delivering food, parents feel in control, and restaurants get reliable delivery. Everything else is post-MVP.

### MVP Scope

| Feature | Included |
|---|---|
| Driver app: onboarding, parental consent, order flow, earnings view | Yes |
| Customer app: browse restaurants, place order, live order status | Yes |
| Real-time GPS tracking (visible to parent during delivery) | Yes |
| Driving behavior capture: speed + harsh braking only | Yes |
| Safety score v1: weighted per-session score | Yes |
| Performance-based pay: 70/30 split calculated at session end | Yes |
| Work-hour enforcement: hard stop at state legal limit | Yes |
| Parent dashboard (web): live map, session history, safety summary, alerts | Yes |
| Stripe Connect weekly payouts | Yes |
| Admin panel: restaurant management, driver approval, manual payout trigger | Yes |
| Push notifications: order assigned, delivery complete, parent safety alert | Yes |
| Gamification (levels, badges, leaderboards) | **No** |
| Phone-held-while-driving detection | **No** |
| In-app chat | **No** |
| Surge pricing | **No** |
| Multi-city | **No** |
| Background check API integration | **No** (manual) |
| KYC via third-party API | **No** (manual) |
| Customer ratings of drivers | **No** |

---

## Phased Development Plan

### Phase 0: Prototype (2–3 months)
**Goal**: Prove the sensor pipeline and consent flow work end-to-end. Internal only.

- Expo app with GPS + accelerometer capture, visualize events on map
- Basic auth, parental consent screen mockup
- Hardcoded restaurant + order flow
- Raw sensor data logged to PostgreSQL
- No payments, no compliance logic

**Exit criteria**: A teen completes a fake delivery, a parent sees the trip on a map, raw sensor data is captured.

---

### Phase 1: MVP (3–4 months)
**Goal**: Real deliveries in one city with 10–20 drivers and 3–5 restaurants.

- Full driver + customer app (React Native)
- Real order lifecycle connected to real restaurants
- Safety scoring v1 (speed + braking)
- Work-hour enforcement engine
- Parent dashboard (Next.js)
- Stripe Connect payouts
- Admin panel basics

**Exit criteria**: 100 real deliveries completed, parents actively using dashboard, zero compliance violations missed.

---

### Phase 2: Beta (2–3 months)
**Goal**: 100+ drivers, hardened safety and compliance, retention features.

- Gamification: safety levels, badges, weekly leaderboard
- Phone-held detection (gyroscope orientation analysis)
- KYC-lite API integration (Persona or Stripe Identity)
- Automated background check workflow
- Customer ratings
- Driver in-app chat with dispatch
- Enhanced parent alerts with configurable thresholds

---

### Phase 3: Scale
**Goal**: Multi-city, operational efficiency, compliance across all US states.

- Microservice extraction: `tracking` and `scoring` split off (high write throughput isolation)
- Multi-state compliance rules engine
- Surge/dynamic pricing
- Restaurant self-service portal
- Insurance integration (per-delivery coverage, e.g. Buckle or Kover)
- Native iOS/Android apps if React Native sensor performance becomes a bottleneck

---

## Legal & Compliance Risks

| Risk | Mitigation |
|---|---|
| Minor labor law violations (hours, times) | Compliance module enforces per-state rules with hard blocks, not soft warnings |
| COPPA | Minimum driver age is 16; customer app age-gate at signup |
| Insurance gap during delivery | Partner with delivery-specific insurer from day one — this is pre-MVP |
| Background checks for minors | Most states allow with consent; require parent co-sign |
| Liability for accident during delivery | Clear independent contractor classification + mandatory insurance disclosure |
| Stripe minor restrictions | Parent co-signs Stripe Express account; payout to parent-controlled account |
| FERPA | School schedule is self-reported, never pulled from school systems |

> **Highest risk**: The insurance coverage gap between personal auto policies (which exclude delivery) and commercial coverage. This must be resolved before the first real delivery — not post-MVP.

---

## Related Documents

- [docs/schema.md](docs/schema.md) — Full database schema with indexes
- [docs/compliance.md](docs/compliance.md) — State-by-state work hour rules reference
- [docs/scoring.md](docs/scoring.md) — Safety score algorithm specification
