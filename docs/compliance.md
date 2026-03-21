# TeenEats: Minor Labor Compliance Reference

This document captures the federal baseline and key state-specific rules that the `compliance` module must enforce. The platform operates as a gig/independent contractor model, but **child labor laws apply regardless of employment classification** when the worker is a minor.

> **This document is a reference baseline, not legal advice. Consult an employment attorney before launch and before expanding to any new state.**

---

## Federal Baseline (FLSA)

The Fair Labor Standards Act (FLSA) establishes the federal floor. States may be more restrictive; TeenEats must always apply the stricter of federal vs. state rules.

| Age | Hours Allowed (school year) | Hours Allowed (non-school) | Time Restrictions |
|---|---|---|---|
| 14–15 | Max 3 hrs/school day, 18 hrs/school week | Max 8 hrs/day, 40 hrs/week | Only 7am–7pm during school year; 7am–9pm June 1–Labor Day |
| 16–17 | Unlimited hours | Unlimited hours | No federal time restrictions (state rules may apply) |

> **TeenEats minimum driver age is 16.** The 14–15 rules are included for reference but will not apply to drivers at launch.

**Driving restriction**: Federal law prohibits 14–15 year olds from driving as part of employment. At 16–17, driving for work is permitted but states often layer additional restrictions.

---

## Platform Enforcement Rules (MVP)

The compliance module will enforce these checks for all drivers aged 16–17:

1. **Daily hour cap** — Enforce the applicable daily limit. Block new session start if cap reached.
2. **Weekly hour cap** — Enforce the applicable weekly limit. Block new session start if cap reached.
3. **Time-of-day block** — Prevent session start outside allowed hours. End active session with 10-minute warning before cutoff.
4. **School night curfew** — Apply state-specific school-night curfews (Sunday–Thursday).
5. **Auto-end session** — If a driver is approaching a time boundary (10 min warning, then hard end), complete any active delivery and block new acceptance.

**Implementation note**: The `drivers.state` field determines which ruleset applies. All hour tracking is done in the driver's home state timezone.

---

## State-by-State Reference

### California
- **16–17, school year**: Max 4 hrs/school day, 8 hrs on non-school days
- **16–17, summer**: Max 8 hrs/day, 48 hrs/week (with work permit)
- **Time restrictions**: 5am–10pm on school nights; 5am–12:30am on non-school nights
- **Work permit**: Required (signed by school and parent). Platform must collect on onboarding.
- **Notes**: California has the most restrictive teen work rules in the country. Work permit is non-negotiable.

### Texas
- **16–17**: No state hour restrictions beyond federal baseline
- **Time restrictions**: No state curfew for work (local ordinances may apply)
- **Work permit**: Not required for 16–17
- **Notes**: Texas defers to FLSA, which has no hour limits for 16+. Good expansion state.

### New York
- **16–17, school year**: Max 4 hrs/school day (Mon–Fri), 8 hrs on weekends/non-school days; 28 hrs/school week
- **16–17, non-school week**: Max 8 hrs/day, 48 hrs/week
- **Time restrictions**: Until 10pm on school nights; until midnight on non-school nights
- **Work permit**: Required (Employment Certificate issued by school)
- **Notes**: NY Department of Labor actively audits. Work permit enforcement is strict.

### Florida
- **16–17, school year**: Max 8 hrs/non-school day; 30 hrs/week during school
- **16–17, summer**: Max 8 hrs/day; no weekly cap stated in statute
- **Time restrictions**: Until 11pm on school nights; until 11:30pm Friday/Saturday
- **Work permit**: Required (Form DH 681 from health department)
- **Notes**: Florida time restrictions are slightly more lenient than NY/CA.

### Illinois
- **16–17, school year**: Max 8 hrs on non-school days; 24 hrs/school week
- **16–17, summer**: Max 8 hrs/day, 48 hrs/week
- **Time restrictions**: Until 10pm school nights; until midnight Friday/Saturday
- **Work permit**: Not required for 16–17
- **Notes**: 24 hr/week school-year cap is one of the more restrictive.

### Washington
- **16–17, school year**: Max 4 hrs/school day, 8 hrs non-school days; 20 hrs/school week
- **16–17, summer**: Max 8 hrs/day, 40 hrs/week
- **Time restrictions**: Until 10pm school nights (L&I may grant variance)
- **Work permit**: Not required for 16–17
- **Notes**: 20 hr/school week cap is among the most restrictive in the country.

### Ohio
- **16–17**: No state hour restrictions (defers to federal; federal has none for 16+)
- **Time restrictions**: Until 11pm school nights; until midnight non-school nights (16-year-olds); no restriction for 17-year-olds on non-school nights
- **Work permit**: Required (Age and Schooling Certificate from school district)

### Georgia
- **16–17**: No state restrictions beyond federal (none for 16+)
- **Time restrictions**: No state curfew for work
- **Work permit**: Not required for 16–17
- **Notes**: Among the most permissive states for 16–17 teen workers.

### Arizona
- **16–17**: Defers to federal baseline; no state hour limits for 16+
- **Time restrictions**: Until 11pm on school nights; until midnight on non-school nights (16-year-olds)
- **Work permit**: Not required for 16–17

---

## Compliance Module Implementation

### Data Inputs Required

| Input | Source | Used For |
|---|---|---|
| `drivers.dob` | Onboarding | Determine age tier |
| `drivers.state` | Onboarding | Select state ruleset |
| `work_sessions` | DB | Calculate daily/weekly hours accumulated |
| School calendar | Self-reported / public calendar | Distinguish school vs. non-school days |
| Current time (driver's timezone) | System | Time-of-day enforcement |

### Enforcement Checkpoints

1. **Session start**: Before accepting any new order, validate:
   - Daily hours not exceeded
   - Weekly hours not exceeded
   - Current time within allowed window
2. **During session**: 10-minute warning notification to driver (and parent) before time boundary
3. **At boundary**: Hard session end — complete current delivery if within reasonable range, then lock app
4. **Daily reset**: Hour counters reset at midnight in driver's local timezone

### Work Permit Handling (MVP)

At MVP, work permit collection is a **manual process**: admin uploads a scanned copy of the permit document, and driver status is set to `approved` only after manual review. Post-MVP can automate via document verification API (e.g., Persona).

States requiring work permits at MVP launch: California, New York, Florida (16–17), Ohio.

---

## Age Verification

Minimum driver age: **16 years old**.

Verification approach:
- Collect `dob` at onboarding
- Cross-reference against driver's license (manual review at MVP)
- Recalculate age at each season change to catch drivers who age into/out of restrictions

Drivers who turn 18 during their tenure shift from minor rules to standard adult labor rules. The compliance module must handle this transition automatically.

---

## Recordkeeping Requirements

FLSA requires employers (and courts have extended this to some gig platforms) to maintain:
- Records of hours worked per day and per week
- Names, addresses, dates of birth of all minor workers
- Copies of age certificates / work permits

TeenEats stores this in `work_sessions`, `drivers`, and a secure document store (post-MVP). Retain records for **3 years minimum**.

---

## References

- [FLSA Child Labor Provisions — DOL](https://www.dol.gov/agencies/whd/child-labor)
- [State Child Labor Laws — DOL Summary](https://www.dol.gov/agencies/whd/state/child-labor)
- California: Labor Code §§ 1285–1312, IWC Wage Orders
- New York: Labor Law §§ 130–144
- Florida: Florida Statutes § 450.021 et seq.
- Illinois: Child Labor Law, 820 ILCS 205
- Washington: RCW 49.12.121 et seq.
