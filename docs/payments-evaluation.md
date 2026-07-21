# Payments evaluation — TibiaEdge premium tier

**Task 16 spike. Status: awaiting owner decision.**
Researched 2026-07-21. Every claim below is dated, because platform eligibility and fee
terms change without notice — re-verify anything older than a few months before acting.

## What is being decided

TibiaEdge sells an AI-assistant premium tier at roughly $4.99/month. The strategy itself is
already locked — gold farming, BaaS and packet reading are permanently out of scope, since
"completely legal" is a hard product requirement. This spike picks only the payment rail.

Two constraints shape the whole decision:

1. **The VPS accepts no inbound connections** (Design invariant 8). Anything requiring an
   inbound HTTP endpoint changes the security posture and needs explicit ops sign-off.
2. **The owner is Mexico-based.** Payout geography is therefore a hard gate, not a detail.

Design invariant 8 fixes the default in advance: **(a) if eligible, else (b); (c) only with
explicit ops sign-off.** This document's job is to establish whether (a) is eligible.

## Method, and what was not done

Verified live against primary documentation where reachable. Two Discord support subdomains
(`support-dev.discord.com`, `support.discord.com`) return HTTP 403 to automated fetches, so
some Discord claims below rest on secondary sources and are labelled as such.

Per the plan's [BRAIN/OWNER] boundary, **no credentials were created and no test-mode round
trip was executed**. Stripe test keys and Discord developer-portal monetization setup are
owner/Brain-held. Where verification needs an authenticated dashboard, it is recorded as a
gap rather than worked around.

---

## Option (a): Discord App Subscriptions

Entitlements arrive as gateway events on the websocket the bot already holds open. On
posture grounds this is the ideal option — there is nothing to expose and nothing to poll.

**It is not available to this owner.**

> "Monetization is currently available only in the United States, European Union, and United
> Kingdom. Premium Apps is not currently available outside of these regions."
> — [Discord developer docs, Enabling Monetization](https://docs.discord.com/developers/monetization/enabling-monetization) (fetched 2026-07-21)

Mexico is not in that set. This is the single fact that decides the spike, and it comes from
Discord's own documentation rather than a third party.

Everything else about (a) checks out, which is worth recording in case eligibility changes:

- **Eligibility checklist** (primary source, same page): app must be verified; app belongs to
  a developer team; team owner 18+; team has verified emails and 2FA; app uses slash commands
  or has approved `Message Content` intent; ToS and Privacy Policy links; valid payout method;
  agreement to the Monetization Terms and Developer Policy. TibiaEdge would satisfy the
  technical items — it is slash-command based and team-owned.
- **Revenue cut** (secondary — the payout article is 403): 15% platform fee for the first
  $1,000,000 USD of cumulative team gross sales ("Growth Tier"), reverting to 30% thereafter.
  The developer share is described as 85% *less payment processing and transaction fees*, so
  15% is not the all-in cost.
- **Entitlement events** ([primary](https://docs.discord.com/developers/monetization/implementing-app-subscriptions)):
  - `ENTITLEMENT_CREATE` — user granted an entitlement to the subscription SKU.
  - `ENTITLEMENT_UPDATE` — fires when an entitlement to a subscription SKU **ends**. Note the
    counterintuitive naming: expiry arrives as UPDATE, not DELETE.
  - `ENTITLEMENT_DELETE` — Discord refunds a subscription, removes an entitlement, or a
    developer deletes a test entitlement.
  - A **List Entitlements** HTTP endpoint exists (filterable by `user_id` / `guild_id`) for
    reconciliation, which matters because a bot that was offline during an event would
    otherwise miss it.
- **Test story**: test entitlements are created and deleted via API, carry no `starts_at` /
  `ends_at`, and persist until deleted — so both subscribed and unsubscribed states are
  testable without payment. Team members additionally receive a 100% discount for exercising
  the real purchase flow.

**Verdict: ineligible on payout geography.** Not on merit — if Discord opens Mexico, this
becomes the best option on every axis except revenue cut.

---

## Option (b): Stripe Payment Link + outbound polling

The bot never receives a connection. It polls Stripe on a timer and grants tiers from what it
finds. Correlation to a Discord user rides on `client_reference_id`, baked into the link URL.

- **Stripe operates in Mexico.** Published pricing is **3.6% + MX$3.00** per domestic card
  transaction, **+1.5%** for international cards, excluding IVA
  ([Stripe MX pricing](https://stripe.com/en-mx/pricing), corroborated by several secondary
  sources; the owner should confirm the rate on their own account, which can differ).
- **`client_reference_id` mechanics** ([primary](https://docs.stripe.com/payment-links/url-parameters)):
  passed as a URL parameter on a Payment Link; alphanumerics, dashes and underscores; max 200
  characters; **invalid values are silently dropped while the page still works**. A Discord
  snowflake is 17–20 digits, so it fits comfortably — but note the silent-drop behaviour is a
  real failure mode: a malformed link yields a successful payment that cannot be attributed.
  The link must be generated by the bot, never hand-assembled.
- **Polling shape** ([primary](https://docs.stripe.com/api/checkout/sessions/list)):
  `GET /v1/checkout/sessions` filters on `status=complete`, `created.gte=<cursor>`,
  `payment_link=<id>`, up to 100 per page. The session object carries both
  `client_reference_id` and `subscription`.
- **Rate limits** are a non-issue: 100 read requests/second in live mode, 25/second in test
  ([Stripe rate limits](https://docs.stripe.com/rate-limits)). A 60-second poll is ~0.017
  req/s — roughly 0.02% of the live budget. Stripe does not bill per API call.
- **Latency**: bounded by the poll interval. A 60-second timer means a subscriber waits at
  most about a minute for their tier, which invariant 8 already accepts ("minutes of lag
  acceptable for tier grants").

### The complexity that is easy to miss

Polling Checkout Sessions captures the **initial purchase only**. A monthly subscription also
renews, lapses, gets cancelled and gets refunded, and none of those create a new Checkout
Session. `client_reference_id` lives on the Session, not on the Subscription.

So the implementation is two-staged, not one:

1. Poll completed Sessions → learn `(discord_user_id, subscription_id)` → **persist that
   mapping** (this is what `entitlements` in migration 006 is for).
2. Poll subscription status on the stored ids → grant and revoke on state changes.

Anyone scoping this as "just poll for payments" will under-build it and ship a tier that is
granted but never revoked. Worth stating plainly in the Task 17/18 brief.

**Verdict: eligible, outbound-only, acceptable lag. This is the fallback invariant 8 names,
and the fallback is what applies.**

---

## Option (c): Stripe webhook

Mechanically the cleanest — Stripe pushes events the moment they happen, no polling, no
two-stage reconciliation. It is also the only option that breaks the outbound-only invariant.

What ops would have to expose ([primary](https://docs.stripe.com/webhooks)):

| Requirement | Detail |
|---|---|
| Public HTTPS endpoint | "Registered webhook endpoints must be publicly accessible HTTPS URLs." HTTP is dev-only. |
| TLS | v1.2 or higher, with a valid certificate — so a real cert plus a renewal story. |
| DNS | A public hostname pointing at the VPS. |
| Firewall | Inbound 443 permitted — the change invariant 8 exists to prevent. |
| New process | An HTTP server inside the bot, i.e. new attack surface on a host that currently has none. |
| Signature verification | HMAC-SHA256 over `timestamp.body`, compared in constant time, with a 5-minute default tolerance. |
| Idempotency | Stripe retries with exponential backoff for up to 3 days in live mode, so handlers must be replay-safe. |

Two variants worth recording, because they change the analysis if the constraint ever moves:

- **Event destinations to Amazon EventBridge or Azure Event Grid** — Stripe can deliver events
  to a cloud bus instead of a webhook, removing the inbound endpoint entirely. It trades the
  firewall change for a cloud dependency and a consumer to write; the bot would still pull.
  If inbound HTTP is ever genuinely needed, this is the option to evaluate before opening 443.
- **`stripe listen --forward-to`** establishes an *outbound* connection and forwards events
  locally, which superficially looks like a way to have webhooks without inbound HTTP. It is
  documented as a development tool. **Not recommended for production**, and recorded here only
  so nobody rediscovers it and mistakes it for a supported pattern.

**Verdict: rejected for now.** It buys latency the product does not need, at the cost of the
one posture guarantee the deployment currently has.

---

## Comparison

| | (a) Discord App Subscriptions | (b) Stripe Link + polling | (c) Stripe webhook |
|---|---|---|---|
| **Eligibility (MX owner)** | ❌ **Ineligible** — US/EU/UK only | ✅ Stripe operates in Mexico | ✅ Same as (b) |
| **Payout geography** | US, EU, UK | Mexico supported | Mexico supported |
| **Revenue cut / fees** | 15% platform fee to $1M, then 30%, less processing fees *(secondary source)* | 3.6% + MX$3.00 domestic, +1.5% international, excl. IVA | Same as (b) |
| **Integration complexity** | Low — events on the existing websocket; List Entitlements for reconciliation | **Medium** — two-stage: sessions for signup, subscription status for renewal/churn | Low–medium — one handler, plus signature and idempotency handling |
| **Latency to entitlement** | Seconds (push) | ≤ poll interval (~60s) | Seconds (push) |
| **Ops burden / posture** | **None** — outbound only | **None** — outbound only | **Inbound 443, DNS, TLS, new HTTP surface → ops sign-off** |
| **Test story** | Test entitlements API + 100% team discount | Test-mode keys and links *(not exercised — owner-held)* | Stripe CLI forwarding |

---

## Open risk: Discord's monetization-requirements policy

This did not come from the brief and it may matter more than the rail choice.

Discord operates a **Monetization Requirements policy, reported as effective 2024-10-07**,
under which developers offering paid capabilities for their apps must also make those
offerings purchasable through Discord's Premium Apps features, at a final price no higher than
elsewhere. External processors such as Stripe or Patreon reportedly remain allowed, but the
Discord path must exist and must not be more expensive.

*(Secondary sources only — the authoritative article,
[Premium Apps' Required Support for Monetizing Apps](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps),
returns 403 to automated fetching and was not read directly.)*

If that reading is right, it collides with the eligibility finding: TibiaEdge would be
required to offer a Discord purchase path it is regionally barred from creating. The possible
resolutions are all owner-level, not engineering-level:

1. The requirement implicitly does not apply where Discord monetization is unavailable.
2. It does apply, and paid features are not permitted from an ineligible region at all.
3. An eligible (US/EU/UK) entity would be needed to comply — a corporate and tax question well
   outside this spike.

**Recommended action, mirroring the CipSoft inquiry in Task 1: ask Discord developer support
in writing and keep the reply.** A one-paragraph question — "our team is Mexico-based and
therefore ineligible for Premium Apps; may we sell a subscription for our app through Stripe,
and if so how do we satisfy the required-support policy?" — converts an assumption into a
record. This should be resolved before launch, though it need not block Task 17's schema work.

---

## Recommendation

**Option (b): Stripe Payment Link + outbound polling.**

Not because it is the nicest design — (a) is, on latency, simplicity and reconciliation — but
because **(a) is ineligible on payout geography, verified from Discord's own documentation**,
and invariant 8's default resolves to (b) exactly in that case.

(c) stays rejected: it costs the outbound-only posture and buys latency the product does not
need. If push delivery ever becomes genuinely necessary, evaluate EventBridge/Event Grid
before opening inbound 443.

Two conditions attach to this recommendation:

1. **Scope the two-stage polling honestly.** Signup detection and renewal/revocation are
   separate mechanisms. A one-stage implementation grants tiers it never takes back.
2. **Resolve the Discord monetization-requirements question before launch**, not before code.

---

## Gaps requiring owner or Brain access

| # | Gap | Why it is open | Blocks |
|---|---|---|---|
| 1 | Discord monetization-requirements policy: exact wording and any regional exception | `support-dev.discord.com` 403s automated fetches; needs a human or a written support answer | Launch, not Task 17 |
| 2 | Stripe test-mode `client_reference_id` round trip not executed | Test keys are owner/Brain-held per the plan | Task 18 verification |
| 3 | Discord Premium Apps payout mechanics (threshold, provider, tax forms) | Payout article 403s | Nothing while (a) is ineligible |
| 4 | Stripe MX fee rate on the owner's actual account | Published rates can differ per account | Pricing model, not code |
| 5 | Whether a US/EU entity would make (a) eligible | Corporate/tax question, outside an engineering spike | Owner discretion |

---

## Decision

**PENDING OWNER SIGN-OFF.**

Per the standing approval-integrity rule, this section is filled in only on an explicitly
submitted owner message or a verbatim `[Brain] OWNER APPROVED: <decision>` relay. Composer
text and dialog selections do not count.

| Field | Value |
|---|---|
| Decision | _(pending)_ |
| Decided by | _(pending)_ |
| Date | _(pending)_ |
| Notes | _(pending)_ |

Tasks 17–18 are gated on this decision.

---

## Sources

- [Discord — Enabling Monetization](https://docs.discord.com/developers/monetization/enabling-monetization) *(primary; eligibility + regions)*
- [Discord — Implementing App Subscriptions](https://docs.discord.com/developers/monetization/implementing-app-subscriptions) *(primary; entitlement events, test entitlements)*
- [Discord — Monetization overview](https://docs.discord.com/developers/monetization/overview) *(primary; no policy/region content)*
- [Discord — Premium Apps' Required Support for Monetizing Apps](https://support-dev.discord.com/hc/en-us/articles/23810643331735-Premium-Apps-Required-Support-for-Monetizing-Apps) *(403 — not read directly)*
- [Discord — Premium Apps Payout](https://support-dev.discord.com/hc/en-us/articles/17299902720919-Premium-Apps-Payout) *(403 — not read directly)*
- [Stripe — Payment Link URL parameters](https://docs.stripe.com/payment-links/url-parameters) *(primary; `client_reference_id`)*
- [Stripe — List Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/list) *(primary; polling filters)*
- [Stripe — Rate limits](https://docs.stripe.com/rate-limits) *(primary)*
- [Stripe — Webhooks](https://docs.stripe.com/webhooks) *(primary; endpoint requirements, retries, EventBridge/Event Grid)*
- [Stripe — Pricing (Mexico)](https://stripe.com/en-mx/pricing) *(fees)*
</content>
