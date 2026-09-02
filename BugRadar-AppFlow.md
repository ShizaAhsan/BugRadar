# BugRadar — Application Flow

**Version:** 1.0 
**Related:** BugRadar-PRD.md, BugRadar-TRD.md
**Last Updated:** August 2026

This document maps the end-to-end user and system flows across BugRadar's core journeys.

---

## 1. New User Onboarding Flow

```
[Landing Page]
     │  clicks "Get Started Free"
     ▼
[Sign Up] — email, password, name
     │
     ▼
[Verify Email] — link sent via transactional email
     │
     ▼
[Create Organization] — org name, slug
     │
     ▼
[Create First Project] — project name + platform (JS / Node / Python)
     │
     ▼
[DSN Generated] — unique ingestion key shown
     │
     ▼
[Setup Instructions Screen] — copy-paste SDK snippet with DSN pre-filled
     │
     ▼
[Empty Dashboard: "Waiting for your first event..."]
     │  (developer integrates SDK, triggers a test error)
     ▼
[First Issue Appears in Real Time] — onboarding checklist marked complete
```

**Key UX principle:** Time-to-first-error should be under 10 minutes — the setup screen gives a copy-pasteable snippet and a live-polling "waiting for events" state so the user gets immediate feedback the moment their SDK sends its first event.

---

## 2. SDK Integration & Error Ingestion Flow

```
[Developer's Application]
     │  error/exception occurs
     ▼
[BugRadar SDK] — captures:
     - error message + stack trace
     - breadcrumbs (recent actions/logs)
     - environment, release/version
     - browser/OS or server runtime info
     - optional user context (scrubbed of PII per config)
     │
     ▼  HTTPS POST (with DSN key)
[BugRadar Ingestion Endpoint]  /ingest/:dsnKey/store/
     │  validate DSN, check rate limit
     ▼
[Redis Queue] — event pushed, 202 Accepted returned to SDK (non-blocking)
     │
     ▼
[Background Worker]
     │  compute fingerprint (error type + normalized top stack frames)
     ▼
     ├── fingerprint matches existing Issue → increment event_count, update last_seen
     └── new fingerprint → create new Issue (status: unresolved)
     │
     ▼
[Store Event row] (Postgres) + [Large payload/source map → OSS if needed]
     │
     ▼
[Evaluate Alert Rules for this Project]
     │
     ├── new issue + "notify on new issue" rule enabled → trigger alert
     └── occurrence spike + threshold rule → trigger alert
     ▼
[Notification Dispatch] — email (MVP) / Slack-Discord webhook (stretch)
```

---

## 3. Dashboard Navigation Flow

```
[Login]
   ▼
[Organization Switcher] (if user belongs to multiple orgs)
   ▼
[Project List] — shows each project with unresolved issue count, last event time
   │  select a project
   ▼
[Issue List]
   - Filters: status (unresolved/resolved/ignored), environment, time range
   - Search by error message/culprit
   - Sort: last seen, event count, first seen
   │  select an issue
   ▼
[Issue Detail Page]
   - Header: title, status badge, assignee, first/last seen, total occurrences, affected users
   - Stack trace (syntax-highlighted, expandable frames)
   - Breadcrumbs timeline (chronological trail of actions before the error)
   - Tags (environment, release, custom tags)
   - Occurrence graph (events per day, sparkline)
   - Actions: Resolve / Ignore / Assign to teammate / Comment
```

---

## 4. Alerting Flow

```
[Admin/Owner configures Alert Rule]
   Project Settings → Alerts → "New Rule"
   │
   ├── Trigger: "On new issue created"
   └── Trigger: "When occurrences > N within M minutes"
   │
   ▼
   Channel: Email (default) or Webhook (Slack/Discord — stretch)
   │
   ▼
[Save Rule] — stored against Project

--- at runtime ---

[Ingestion worker evaluates rules after each processed event]
   │
   ├── condition met → [Notification Dispatch]
   │        │
   │        ├── Email: sent via transactional email provider (Brevo/DirectMail)
   │        └── Webhook: POST to configured Slack/Discord incoming webhook URL
   │
   └── condition not met → no action
```

---

## 5. Team Collaboration Flow (Roles)

```
[Owner]
   │  Organization → Members → "Invite Member"
   ▼
[Invite Email Sent] — includes signup/join link tied to org
   │
   ▼
[Invitee] clicks link → signs up (or logs in if existing user) → joins Organization
   │
   ▼
[Role Assigned] — Owner sets role: Admin or Member
   │
   ▼
[Access Scoped by Role]
   - Owner: billing, org settings, all project access, invite/remove members
   - Admin: manage projects, alert rules, resolve/assign issues — no billing access
   - Member: view issues, comment, resolve/assign — no settings/billing access
```

---

## 6. Billing & Upgrade Flow

```
[User on Free Plan] hits plan limit banner (e.g., "80% of monthly event quota used")
   │  clicks "Upgrade to Pro"
   ▼
[Plan Comparison Page] — Free vs Pro (events/month, retention, project limits)
   │  selects Pro
   ▼
[Checkout Initiated]
   │
   ├── Primary path: Payoneer Checkout session created via BugRadar backend
   │        → user redirected to Payoneer-hosted checkout
   │        → completes payment
   │        → redirected back to BugRadar with status
   │
   └── Local fallback path: Safepay / PayPro / JazzCash / Easypaisa checkout
            (for PKR-only customers without international payment method)
   │
   ▼
[Payment Provider Webhook → BugRadar /api/billing/webhook]
   │  signature verified
   ▼
[Subscription record updated] — plan = pro, status = active, current_period_end set
   │
   ▼
[Organization limits raised immediately] — event quota, retention, project count updated
   │
   ▼
[Confirmation email sent to Owner]
```

> **Hackathon note:** For the live demo, this flow can run against Payoneer's sandbox/test mode (or be mocked end-to-end) since real merchant approval and production credentials typically take longer than a hackathon timeline to provision. The flow above represents the intended production behavior; the TRD documents the MVP shortcut (manual re-checkout vs. true auto-renewal).

---

## 7. Issue Resolution Lifecycle

```
[Issue Created] (status: unresolved)
     │
     ├── Team investigates → fixes bug → deploys fix
     │        │
     │        ▼
     │   [Mark as Resolved] (manually, or auto-resolve on next release tag — stretch)
     │        │
     │        ▼
     │   Issue reoccurs after "resolved"? → [Auto-reopen] status: unresolved (regression)
     │
     └── Team decides it's noise/expected → [Mark as Ignored]
              │
              ▼
        No further alerts fire for this issue while ignored
```

---

## 8. Error State / Edge Case Flows

| Scenario | Flow |
|---|---|
| DSN key invalid/revoked | Ingestion endpoint returns `401`, event dropped, no queue entry created |
| Rate limit exceeded for a project | Ingestion endpoint returns `429`; excess events logged/counted but not stored, project owner notified via dashboard banner |
| Free plan event quota exceeded | New events still counted for quota display but oldest overflow may be dropped or queued for delayed processing; upgrade prompt shown |
| Payment webhook fails signature check | Request rejected, logged for manual review, subscription status unchanged |
| Worker crashes mid-processing | Redis queue retains unacknowledged jobs; worker restart (via process manager) resumes processing — no event loss under normal restart conditions |
