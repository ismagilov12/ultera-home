# ULTERA journey v1

Production flow: consented browser → same-origin `/api/journey` → private `ulhome_journey_events`. Both `/api/order` stages attach the same checkout to the saved order via `ulhome_order_journeys`. Admin: Orders → expand an order → “Шлях клієнта на сайті”.

- A visitor ID identifies a browser storage profile, not a person. It expires after 180 days; sessions rotate after 30 minutes of inactivity. Checkout ID survives reload and validation errors.
- No behavioral requests before consent. DNT/GPC overrides consent. Revocation clears the browser identifier and pending queue; it does not erase already received records. This control covers this first-party journey, not existing Meta advertising integrations.
- Payloads are allowlisted twice. Never add form values, names, phone numbers, delivery selections, arbitrary DOM text, full URLs, raw exceptions, card details or credentials.
- Browser events are untrusted. Only the order handler emits `order_saved` after the local order insert. This is not a CRM approval, bank payment or proof of delivery. Drafts have a separate `checkout_draft_saved` event. Current payment/CRM states come from the order, and retain their existing sync schedule.
- Transport is bounded, idempotent and best-effort; ad blockers, denied consent, offline/reload loss and different devices cause gaps. No cross-device or Direct/phone identity merge is implemented.
- New tables have RLS, no anonymous grants and admin-only authenticated SELECT. Writes use a server-only key, a same-origin allowlist and a keyed-IP rate limit. GET additionally verifies Auth and admin membership; financial release lock is preserved.
- New admin RPCs are SECURITY INVOKER, guarded by existing ULTERA admin authorization. Their private compatibility view retains historical counts and never adds persistent IDs to the old publicly-readable analytics table. Event counts are not labelled as conversion rates.
- `utm_source=qa` marks synthetic browser events `is_test=true`; these are omitted from the compatibility analytics. Do not submit live test orders or start bank payments for tracking QA.
- Admin history is bounded to 180 days / 500 events and 100 related orders, with explicit truncation. Database event retention is not automatically purged in v1; add an owner-approved retention/deletion policy before collecting long-term history. SQL reference files under `db/` correspond to the additive remote schema changes.

Verification: `node --test tests/*.test.cjs`; validate production browser event → private DB row, no-consent behavior, private read rejection, original cart size/version and unchanged order/payment calculations. Never copy credentials or real customer data into fixtures or public files.
