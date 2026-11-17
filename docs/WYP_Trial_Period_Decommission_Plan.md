# Decommissioning the Private Testing free-trial mechanism — run this LATER, not now

**Status: drafted and stored, deliberately not applied.** This is the exact
cleanup for the Private Testing free-trial feature (migration 098, auto-grant
reverted same day by migration 099 — see `docs/Week7+ - SQL history.txt` and
CLAUDE.md's own 2026-11-16 entries for the full history). The mechanism
itself — `app_settings_date`, `schedule_trial_close()`, `get_trial_close_date()`,
`admin_get_trial_subscriber_count()`, the Admin → Private Testing Close
screen, cron `tick/route.ts`'s Phase G revert sweep, and the client-side
notices on `/login`/Create Free Account/Account Status — is **still live and
intact** as of 2026-11-16. Jim's own instruction: "maybe you can 'store' the
work. after the trial period it will be needed..." — meaning don't remove any
of this now; keep this plan ready so the actual removal is a quick, exact
copy-paste once the trial period has genuinely run its course (a close date
has been scheduled and enforced, or Jim otherwise decides the feature is
truly done).

A first attempt at this exact cleanup was built and pushed as commit
`0bed91c` on 2026-11-16, then reverted the same day as commit `9e2453c` once
it became clear Jim's "clean up old code/notes" meant something much
narrower (re-closing signup) — the trial-grant mechanism itself was never
meant to be abandoned. Both commits still exist in git history.

## When this is actually ready to run

Not now. Revisit this once the Private Testing free-trial period has really
ended for real users — not just because signup is gated again (that's
independent; see CLAUDE.md's 2026-11-16 entries) — and Jim confirms the
mechanism itself (scheduling a close date, the 30-day notice, the dormant
code) has no further use.

## Step 1 — reapply the exact app-code removal

The full diff (13 files, `AdminTrialCloseForm.tsx` + its route + the
schedule-trial-close API route deleted outright; `onTrial`/`trialCloseDate`
plumbing removed from `SubscriptionPanels.tsx`/`AccountForm.tsx`/
`SubscriptionForm.tsx`/`CreateFreeAccountForm.tsx`; cron Phase G removed;
the trial email templates removed from `email.ts`; the Admin Housekeeping
row removed; one privacy-policy sentence trimmed) is already written and
sitting in git history as commit `0bed91c`. Reapply it with:

```bash
git revert 9e2453c
```

(`9e2453c` is the commit that reverted `0bed91c` — reverting the revert
re-applies the original cleanup cleanly, rather than a riskier cherry-pick
onto a possibly-diverged tree.) Run `npx tsc --noEmit` and `npm run lint`
afterward, same as any other change in this repo.

## Step 2 — run this SQL (migration 100, not yet assigned a real number —
confirm the next open migration number in `docs/Week7+ - SQL history.txt`
at the time this is actually run, since other migrations will have landed
between now and then)

```sql
-- Defensive first: revert any account that may have picked up the 098
-- auto-grant and never got swept by Phase G (e.g. if a close date was
-- scheduled and enforced, most such rows will already be 'free' — this
-- is a no-op for those, and only catches genuine stragglers).
update public.profiles set tier = 'free'
where trial_subscriber_granted_at is not null
  and tier = 'subscriber'
  and stripe_subscription_id is null;

drop function if exists public.schedule_trial_close(date);
drop function if exists public.get_trial_close_date();
drop function if exists public.admin_get_trial_subscriber_count();
drop table if exists public.app_settings_date;

alter table public.profiles
  drop column if exists trial_subscriber_granted_at;
```

Verify after running:

```sql
select to_regprocedure('public.schedule_trial_close(date)');
  -- should be null
select to_regclass('public.app_settings_date');
  -- should be null
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'trial_subscriber_granted_at';
  -- should return zero rows
```

Record the real migration number and a "confirmed run" note in
`docs/Week7+ - SQL history.txt` and in CLAUDE.md, same as every other
migration in this project's history, once it's actually been run.

## Not part of this cleanup

Closing/reopening the signup gate itself
(`app_settings.signup_gate_enabled`) is a separate, already-independent
decision — this plan only removes the trial-*grant* mechanism, not the
signup gate.
