# TeenEats: Safety Score Algorithm

The safety score is TeenEats' core mechanism for incentivizing safe driving, providing parent visibility, and calculating performance-based pay bonuses. This document defines the algorithm for MVP and its planned evolution.

---

## Design Goals

1. **Transparent** — Drivers and parents must understand exactly why a score is what it is.
2. **Actionable** — Scores should change meaningfully based on behavior, not be permanently anchored to early mistakes.
3. **Resistant to gaming** — Detect and handle edge cases like GPS dropouts, stationary phone manipulation, etc.
4. **Pay-linked** — The score directly affects driver earnings, so it must be fair and explainable.

---

## MVP Algorithm

### Session Score

A safety score is calculated after every completed delivery session. It starts at 100 and penalties are subtracted for driving events detected during the session.

```
session_score = max(0, 100 - sum(penalties))
```

#### Penalty Table (MVP)

| Event Type | Severity | Penalty Points | Detection Method |
|---|---|---|---|
| Speed violation | Low (1–10 mph over) | -3 | GPS vs. speed limit lookup |
| Speed violation | Medium (11–20 mph over) | -8 | GPS vs. speed limit lookup |
| Speed violation | High (>20 mph over) | -20 | GPS vs. speed limit lookup |
| Harsh braking | Any | -5 | Accelerometer: deceleration > 0.4g |
| Rapid acceleration | Any | -3 | Accelerometer: acceleration > 0.4g |

> **MVP excludes**: sharp cornering, phone-held detection, distracted driving. These are added in Phase 2.

#### Penalty Caps per Session

To prevent a single bad moment from destroying a session score unfairly:
- Max penalty from speed violations: **-40 points** per session
- Max penalty from braking/acceleration events: **-30 points** per session
- Total minimum session score: **0** (never negative)

This means a driver who speeds briefly but drives well otherwise will not score 0.

#### Example Session

```
Session events:
  - Speed violation (Low, 7 mph over): -3
  - Speed violation (Medium, 15 mph over): -8
  - Harsh braking x2: -5, -5

Total penalties: 21
Session score: 100 - 21 = 79
```

---

### Rolling Safety Score

The rolling score is what appears on the driver's profile, parent dashboard, and leaderboard. It represents the driver's overall trend, not a single session.

```
rolling_score = weighted average of last N sessions
```

**Weighting**:
- Last 5 sessions: weight = 2.0x
- Sessions 6–20: weight = 1.0x
- Sessions beyond 20: not included (too old to be relevant)

**Formula**:
```
recent_sessions = last 5 sessions, each weight 2
older_sessions  = sessions 6–20, each weight 1

total_weight = (min(5, count) * 2) + (max(0, min(15, count - 5)) * 1)

rolling_score = sum(score_i * weight_i) / total_weight
```

**New driver handling**: Drivers with fewer than 3 completed sessions display "Not enough data" instead of a score on the public leaderboard. The score is still calculated internally and used for pay bonuses from session 1.

---

### Pay Bonus Calculation

Driver pay is split 70/30 (base/bonus). The bonus portion scales linearly with the rolling safety score.

```
base_pay     = delivery_fee * 0.70
max_bonus    = delivery_fee * 0.30
bonus_pct    = rolling_score / 100
bonus_pay    = max_bonus * bonus_pct

driver_pay   = base_pay + bonus_pay
platform_cut = delivery_fee - driver_pay
```

**Example**:
```
delivery_fee  = $8.00
rolling_score = 82

base_pay  = $8.00 * 0.70 = $5.60
max_bonus = $8.00 * 0.30 = $2.40
bonus_pay = $2.40 * 0.82 = $1.97

driver_pay   = $5.60 + $1.97 = $7.57
platform_cut = $8.00 - $7.57 = $0.43
```

At a 100 score the driver earns the full $8.00. At a 70 score they earn $7.28. The floor ensures drivers always earn at least 70% and have a strong incentive to maintain a high score.

---

### Score Breakdown (for UI)

The `safety_scores.breakdown` JSONB field stores the per-event-type summary for display on the driver and parent dashboards:

```json
{
  "speed_violations": {
    "count": 2,
    "penalty_points": 11
  },
  "harsh_braking": {
    "count": 2,
    "penalty_points": 10
  },
  "rapid_acceleration": {
    "count": 0,
    "penalty_points": 0
  },
  "session_score": 79,
  "events": [
    { "type": "speed_violation", "severity": "low",    "mph_over": 7,  "penalty": 3, "lat": 37.77, "lng": -122.41, "ts": "..." },
    { "type": "speed_violation", "severity": "medium", "mph_over": 15, "penalty": 8, "lat": 37.78, "lng": -122.42, "ts": "..." },
    { "type": "harsh_braking",   "severity": "any",    "g_force": 0.52, "penalty": 5, "lat": 37.79, "lng": -122.43, "ts": "..." },
    { "type": "harsh_braking",   "severity": "any",    "g_force": 0.48, "penalty": 5, "lat": 37.80, "lng": -122.44, "ts": "..." }
  ]
}
```

This enables the parent dashboard to show a map of exactly where each event occurred.

---

## Sensor Data Collection

### Batching Strategy

Continuously streaming every sensor reading is bandwidth-intensive and drains battery. Instead:
- GPS: polled every **5 seconds** during active session
- Accelerometer + Gyroscope: sampled at **50 Hz**, batched into 5-second windows
- Batch POSTed to `/tracking/events` every **5 seconds**

### GPS Speed vs. Posted Speed Limit

At MVP, speed limit data is sourced from the **Google Roads API** (`snapToRoads` + `speedLimits` endpoints). The driver's GPS coordinates are matched to the nearest road segment and the speed limit for that segment is retrieved.

**Limitation**: Google Roads speed limit coverage is incomplete in some areas. When the speed limit cannot be determined:
- Speed violations are **not recorded** (avoid false positives)
- The gap is logged for review

### Harsh Braking / Acceleration Detection

Raw accelerometer data (in g-forces) is processed per 5-second batch:
1. Remove gravity component using a low-pass filter
2. Calculate resultant acceleration: `sqrt(x² + y² + z²)`
3. If peak resultant in the batch exceeds threshold → record event

**Thresholds (MVP)**:
- Harsh braking: peak deceleration > **0.4g** longitudinally
- Rapid acceleration: peak acceleration > **0.4g** longitudinally

**False positive mitigation**:
- Require the event to persist for at least **300ms** (not a single spike)
- Ignore events when GPS speed < **5 mph** (parking lot, stop-and-go at lights)
- Ignore events when the phone is detected as stationary (gyroscope near-zero)

---

## Phase 2 Additions

### Phone-Held Detection

Using gyroscope orientation:
- A phone lying flat on a seat or in a mount shows near-zero roll/pitch
- A phone held in the hand shows significant roll and pitch variation correlated with driving motion
- Detection: if phone orientation is non-flat for >30 continuous seconds during motion (GPS speed >5 mph), flag a `phone_held` event

**Penalty**: -20 points per `phone_held` event (maximum -20 per session — this is a serious violation).

**Parent alert**: Triggers an immediate push notification to parent when detected.

### Sharp Cornering

Using gyroscope yaw rate:
- Yaw rate > **0.5 rad/s** sustained for >1 second during a turn → `sharp_cornering` event
- Penalty: -4 points per event

### Distracted Driving (Phase 3)

Microphone-based ambient sound analysis to detect in-call audio patterns. Privacy-sensitive; requires explicit consent and on-device processing only (no audio leaves the phone).

---

## Score Display Tiers

For both the driver app and parent dashboard, scores are displayed with a human-readable tier label:

| Score Range | Tier | Color |
|---|---|---|
| 90–100 | Excellent | Green |
| 75–89 | Good | Light green |
| 60–74 | Fair | Yellow |
| 40–59 | Needs Improvement | Orange |
| 0–39 | Poor | Red |

A driver at "Poor" for 3 consecutive sessions triggers an automatic review flag in the admin panel.

---

## Score Reset Policy

Scores are **never permanently reset**. However:
- Drivers who have been inactive for >60 days and return will have their rolling score recalculated from their most recent 10 sessions only (older sessions expire from the window)
- Appeals: a driver may appeal a specific event within 48 hours; admin review can remove the event and recalculate. All appeals are logged.

---

## Anti-Gaming Considerations

| Attack Vector | Mitigation |
|---|---|
| Driver puts phone in mount, drives normally | Desired behavior — no penalty |
| Driver hands phone to passenger who holds it still | Gyroscope will show motion inconsistency vs. GPS motion; flag for review (Phase 2) |
| Driver speeds up/brakes slowly to stay under g threshold | g-threshold is calibrated to real dangerous events; slow changes are safe driving |
| Driver pauses app / kills GPS | Session end forced; no score recorded for incomplete sessions; admin flagged |
| GPS spoofing | Speed anomaly detection: if GPS shows teleportation or impossible speeds, session is invalidated |
