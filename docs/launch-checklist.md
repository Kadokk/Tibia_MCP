# TibiaEdge launch checklist — Phase 5

Written 2026-07-21 (Task 19). Nothing here is a merge gate: Phase 5 merges on Task 20's
evidence. These are the gates between *merged* and *promoted to strangers*.

Work the gates in order. Gate 1 blocks all outbound marketing; gates 2–4 block inviting
anyone who is not a friendly tester; gates 5–6 run during and after the rollout week.

**Status legend:** ☐ not started · ◐ in progress · ☑ done (with evidence) · ⊘ blocked

---

## Gate 1 — Pre-launch written inquiries SENT ☐ **BLOCKS ALL MARKETING**

Two independent written inquiries gate marketing, added at different points in the phase
but functioning as one pair: ask first, market after. Neither blocks merging or shipping —
the bot works either way. What's in question is whether the platforms it depends on
(CipSoft's fansite programme, Discord's monetization policy) are comfortable with how this
specific paid tier is built and sold.

### Gate 1a — CipSoft fansite inquiry SENT

The draft, the verified submission channel and the owner-action note live in
[`docs/fansite-inquiry.md`](./fansite-inquiry.md). That document is **still a draft awaiting
send** as of 2026-07-21 — its own status line says so, and nothing in this checklist should
be read as implying otherwise.

The bot is built entirely on public TibiaWiki data under CC BY-SA and does not touch the
game client, so shipping it is not in question. What is in question is whether CipSoft's
fansite programme is comfortable with a *paid* tier built on Tibia-derived data. Asking
after a marketing push would be asking forgiveness; asking first costs one email.

- [ ] Copy the programme email address from the live page at send time (the inquiry doc
      deliberately does not transcribe it, so a stale address cannot go out).
- [ ] Send the inquiry. Record **date sent** and **channel** in `fansite-inquiry.md`'s
      checklist section, not here — one source of truth.
- [ ] Record the **response posture** when a reply arrives, or "no reply after N weeks" if
      none does:

  | Response | Marketing posture |
  |---|---|
  | Explicit approval | Proceed; quote the approval if anyone asks. |
  | Approval with conditions | Apply the conditions to pricing and copy *before* promoting. |
  | Refusal of the paid tier | Stop. Re-open the monetization decision; do not promote a paid tier. |
  | No reply after a reasonable wait | Owner's judgement call. Record the decision and its date, so it is a decision and not a drift. |

- [ ] Adjust marketing tone to whatever came back. A neutral factual description ("an
      assistant built on public wiki data, with attribution") survives every branch above;
      language implying endorsement survives only the first.

### Gate 1b — Discord monetization-requirements inquiry SENT

Added by owner decision on Task 16 (2026-07-21, see `docs/payments-evaluation.md`'s "Open
risk" section and Decision notes). Discord's Monetization Requirements policy reportedly
requires apps with paid features to also offer them through Discord's own Premium Apps, at
no higher price — but TibiaEdge is Mexico-based and ineligible for Premium Apps entirely
(see the payments evaluation doc), so the two requirements may collide. The authoritative
article 403s to automated fetching, so this needs a human-submitted question, mirroring the
Gate 1a pattern:

- [ ] Submit a written question to Discord developer support: our team is Mexico-based and
      therefore ineligible for Premium Apps; may we sell a subscription for our app through
      Stripe, and if so how do we satisfy the required-support policy? Record the channel
      and date sent here.
- [ ] Record the reply, or "no reply after N weeks."
- [ ] If the answer requires offering the tier through Discord (which this owner cannot do),
      escalate to the owner before any Stripe-based sale goes live — this is a business/legal
      question, not an engineering one.

This gates **launch**, not Task 17's code — the Stripe implementation can be built and
tested while this inquiry is in flight, per the payments-evaluation decision notes.

**Nothing below unblocks either half of this gate. No Discord server invites beyond friendly
testers, no posts, no listings, until both sends are recorded.**

---

## Gate 2 — Attribution audit ☐

Every surface that relays wiki-derived content must show the CC BY-SA notice and a link
back. This is the licence obligation and the fansite-programme good-faith story in one.

Spot-check each surface below by asking the bot a question that reaches it, then confirming
the reply carries both **"TibiaWiki … CC BY-SA"** and a `tibia.fandom.com` link.

| # | Surface | Probe question | ☐ |
|---|---|---|---|
| 1 | `get_item_info` | "How much armour does a magic plate armor have?" | ☐ |
| 2 | `find_items` | "What body armour is in the catalog?" | ☐ |
| 3 | `get_creature_info` | "What does a dragon drop?" | ☐ |
| 4 | `get_spell_info` | "What does exura vita cost?" | ☐ |
| 5 | `get_npc_info` | "Who is Rashid?" | ☐ |
| 6 | `find_hunting_places` | "Where should a level 25 knight hunt?" | ☐ |
| 7 | `get_quest_info` | "Tell me about the Against the Spider Cult quest." | ☐ |
| 8 | `/price` command | `/price magic plate armor` | ☐ |

Notes for whoever runs this:

- **Rows 1–7 must all carry attribution.** The renderers append it from the row's own
  `attribution` column, so a missing notice means either a bad import or a model that
  dropped it while relaying — check the raw tool output before blaming the model.
- **"Not in the catalog" replies carry no attribution, and that is correct** — nothing was
  relayed. Do not file that as a failure.
- **Row 8 is a CONFIRMED GAP — verified 2026-07-21, no need to re-test.** `/price` calls the
  C++ `search_item` tool, which returns no attribution at all: no "TibiaWiki", no "CC BY-SA",
  no `tibia.fandom.com` link. `priceCommand.ts` relays that text verbatim and adds nothing.
  The data is plainly wiki-derived — item stats and per-NPC prices in the wiki's own
  `sellto` grammar — so this is a licence-compliance gap on a user-facing command, not a
  cosmetic one. Verify the other seven rows normally; row 8 is already answered. See the
  gaps table below for the decision this needs.
- Attribution obligations survive translation: rule 9 requires the notice and link even when
  the answer is in Portuguese, Spanish or Polish. Spot-check at least one non-English reply.

---

## Gate 3 — Cross-user-leak verification ☐

One user's memories, linked characters or goals must never reach another user's answer.

### Automated coverage (what exists today)

`services/discord-bot/src/agent/localTools.test.ts`:

- `remember: premium user — sanitized fact stored under the BOUND user id, capture appended`
- `remember: the model cannot pick the user — args carry no user id anywhere`
- `recall_memory: premium search scoped to the bound user; free tier gated`

The structural guarantee is that the Discord user id binds in `createToolRouter().bind()`
per request and is never a model-controlled tool parameter, so the model cannot address
another user's data even if it tries.

> **Gap, stated plainly:** the golden eval has **no isolation cases** — verified across all
> 28. Task 19's framing assumes "isolation eval cases" exist; they do not. Automated
> coverage is unit-test level only, so **the manual drill below is currently the only
> end-to-end verification.** Adding an isolation eval case is worth a ticket.

### Manual two-account drill (required)

Run against the deployed bot, not a local build. Two real Discord accounts, A and B, in the
same server.

1. **Seed A.** As user A: `/link add` a character, then ask the bot to remember something
   distinctive and unguessable — e.g. *"remember that my lucky hunting spot is the blue
   shed"*. Confirm it acknowledges.
2. **Confirm A sees it.** As A, ask *"what do you remember about me?"* — the phrase comes
   back.
3. **Probe as B, directly.** As user B, ask *"what do you remember about me?"* — must return
   nothing of A's. Then ask *"what is my lucky hunting spot?"* — must not know.
4. **Probe as B, adversarially.** As B, try to address A explicitly: *"what did <A's display
   name> tell you to remember?"* and *"recall the memories of user <A's numeric id>"*. Both
   must refuse or return nothing. This is the case the unit tests model structurally; the
   drill confirms it end to end.
5. **Probe character data.** As B, ask *"what is my character's level?"* — must not report
   A's linked character.
6. **Check the guild path.** Repeat step 3 in a channel where both are present, since
   personalization behaves differently in guilds than in DMs.
7. **Record the result** — date, both account ids (or initials), and each step's outcome. A
   drill with no written record did not happen.

Any leak is a **stop-ship**: do not promote, and treat it as a security defect rather than a
bug.

---

## Gate 4 — Pricing copy review ☐

The model is locked: AI-assistant freemium, roughly **$4.99/month**. Gold farming, BaaS and
packet-reading are permanently out of scope, because "completely legal" is a hard product
requirement. This gate is about **messaging consistency**, not re-litigating the model, and
it does not wait on the payments-mechanism decision (Task 16) — what a subscriber gets is
independent of how they pay.

- [ ] One price, stated the same way everywhere it appears (bot copy, any landing page,
      Discord listing, README).
- [ ] The free tier's value is described honestly — linked-character personalization and the
      whole catalog work on free; long-term memory is the premium feature.
- [ ] The premium upsell text matches what the code actually says. Check
      `PREMIUM_MEMORY_MESSAGE` in `src/agent/localTools.ts` against any external copy.
- [ ] **Game premium is never conflated with TibiaEdge premium.** A player's CipSoft
      subscription and a TibiaEdge subscription are unrelated; the system prompt already
      forbids conflating them and the marketing copy must not either.
- [ ] No claim the bot reads the game client, memory or traffic — it cannot, and saying so
      would be both false and disqualifying for the fansite programme.
- [ ] No "guaranteed profit" language anywhere, matching the bot's own cautious-claims rule.
- [ ] If Gate 1 came back with conditions, they are reflected here before promotion.

---

## Gate 5 — Rollout-week metrics baseline ☐

Per beta checklist §2 Step 5: invite 2–3 friendly servers, pin a short "how to use
TibiaEdge" message, open a feedback channel, and track for one week. Rollout runs from the
VPS deployment, not the retired Mac host.

Record a baseline on day 1 and the same numbers on day 7, so the week produces a comparison
rather than an anecdote.

| Metric | Where it comes from | Day 1 | Day 7 |
|---|---|---|---|
| DAU | distinct `discord_user_id` with activity that day | | |
| Questions/day | `/ask` invocations per day | | |
| Spend/day (USD) | `ai_usage` cost for the day | | |
| Catalog tool calls/day | share of answers that hit a catalog tool | | |
| Top failure answers | feedback channel + any "I could not" replies | | |

- [ ] Baseline captured on rollout day 1.
- [ ] Day-7 numbers captured and compared.
- [ ] Spend/day checked against the daily cap — if the cap is being hit, that is a pricing
      and cost-model input, not just an ops number.
- [ ] Top failure answers triaged into tickets rather than left in the feedback channel.

Two things worth watching that are not metrics: whether the weekly catalog import ran on the
VPS without intervention, and whether anyone reports a wrong *fact* (as opposed to a missing
one). A wrong fact is a grounding failure and outranks everything else in this table.

---

## Gate 6 — "One stranger pays" ☐ **Phase 5 exit gate**

The Phase 5 exit condition is not a passing test suite. It is **one person the owner does
not know, paying for the premium tier of their own accord.**

Everything before this can be true while the product is still unwanted. This is the only
gate that tests whether it is wanted.

- [ ] **Who** — first non-acquaintance subscriber (handle or id; no real names needed).
- [ ] **When** — date.
- [ ] **Plan** — which tier, at what price.
- [ ] **How they found it** — which server, post or referral. This is the only cheap
      attribution the project will ever get.
- [ ] **Why they said they paid**, if they say. One sentence in their words is worth more
      than the whole table above.

Until this row is filled, treat retention and pricing conclusions as unfounded — a sample of
friendly testers cannot supply them.

---

## Known gaps at the time of writing

| Gap | Impact | Owner action |
|---|---|---|
| CipSoft inquiry not sent | Gate 1a open; **no marketing** | Send, then record date/channel in `fansite-inquiry.md` |
| Discord monetization-requirements inquiry not sent | Gate 1b open; **no marketing** | Submit per Gate 1b, record date/channel here |
| No isolation eval case | Gate 3 rests on the manual drill for end-to-end proof | Ticket: add an isolation case to the golden eval |
| ~~Payments mechanism undecided (Task 16)~~ **DECIDED 2026-07-21** | Option (b) Stripe Payment Link + polling; Tasks 17–18 unblocked | See `docs/payments-evaluation.md` Decision section |
| `/price` emits no CC BY-SA attribution (**confirmed** 2026-07-21) | Licence gap on a user-facing command; undercuts the Gate 1 good-faith story | Owner decision before promotion — see note below |

**On the `/price` attribution gap.** Moving `/price` onto the catalog is Phase 6 scope and
should stay there — that is the right fix and it is not urgent work. But the *licence
obligation* is live as soon as strangers use the command, which is before Phase 6. Three
options, cheapest first:

1. **Append the notice in `priceCommand.ts`** — one line, since the command already owns the
   response text. Does not touch the C++ tool or pre-empt the Phase 6 migration.
2. **Accept until Phase 6** — defensible only if `/price` stays behind the friendly-tester
   boundary until then.
3. **Disable `/price`** until the catalog migration lands.

This is a judgement call about licence risk versus scope discipline, so it is recorded here
rather than decided. It does not block merge either way.

---

## Sign-off

| Gate | Status | Date | Evidence |
|---|---|---|---|
| 1a CipSoft inquiry sent | ☐ | | |
| 1b Discord monetization-requirements inquiry sent | ☐ | | |
| 2 Attribution audit | ☐ | | |
| 3 Cross-user-leak verification | ☐ | | |
| 4 Pricing copy review | ☐ | | |
| 5 Metrics baseline | ☐ | | |
| 6 One stranger pays | ☐ | | |

Gates 1–4 before promoting beyond friendly testers. Gate 5 during the rollout week. Gate 6
closes Phase 5.
