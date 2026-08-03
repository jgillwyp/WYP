# Would You Please — Week 1 Setup

Turning the "this week" column of the architecture map into concrete steps. The goal by end of week: a real repository, deployed to a live URL, backed by a real Postgres database with magic-link login, and one screen — Add Contact — reading and writing actual data. No AWS, no credits, no cost.

This is deliberately the lowest-risk starting point. Add Contact is single-user, has no secure-link surface, and exercises the entire stack end to end (auth → database → UI → deploy). It is the learning vehicle; the harder pieces (the secure recipient link, the request flow) come after the stack is proven.

A note on your background: the concepts here that will be genuinely new are the modern-web *mechanics* — the declarative UI model, the package/build toolchain, and Supabase's Row-Level Security as the way to express access rules. The things that are *not* new to you are the ones that usually scare people off: a relational schema, multi-user access control, and a server mediating external access to sensitive data. You have shipped those. Lean on that; treat the week as translating a model you know into this stack's idioms.

---

## What you are standing up

| Piece | Tool (free tier) | Replaces, from PRD §8.2 |
|---|---|---|
| Code + framework | Next.js (React) + TypeScript | React SPA/PWA |
| Host + deploy | Vercel | CloudFront / AWS hosting |
| Database + auth + storage | Supabase | RDS + Cognito + S3 |
| Email (later this week) | Resend | SES |
| Error tracking | Sentry | (new — cheap insurance) |

Everything above has a permanent free tier sufficient for development and a closed beta.

---

## Day 1 — Accounts, repo, and a deployed skeleton

The point of Day 1 is to have *something live on a real URL* before writing any feature code. Deploy first, build second — it removes the "it works on my machine" gap permanently.

1. **Create the accounts** (all free, no card required for the free tiers): GitHub, Vercel (sign in with GitHub), Supabase (sign in with GitHub). Keep the browser tabs open.

2. **Install the local tools** on your machine: Node.js (the LTS version) and Git. Verify in a terminal:
   ```
   node --version
   git --version
   ```

3. **Create the project.** In a terminal, in a folder where you keep code:
   ```
   npx create-next-app@latest wyp --typescript --app --eslint
   cd wyp
   npm run dev
   ```
   Open `http://localhost:3000`. You now have the app running locally. `create-next-app` is the modern equivalent of scaffolding a new project skeleton — it lays down the folder structure, the build tooling, and a starter page.

4. **Put it on GitHub.** Create an empty repository named `wyp` on GitHub, then:
   ```
   git remote add origin https://github.com/<you>/wyp.git
   git branch -M main
   git push -u origin main
   ```

5. **Deploy to Vercel.** In Vercel, "Add New Project," import the `wyp` GitHub repo, accept the defaults, and deploy. Within a minute you have a live URL like `wyp-xxxx.vercel.app`. From now on, every `git push` to `main` auto-deploys — that is your entire CI/CD pipeline, for free.

**End of Day 1 test:** your starter page is visible both at `localhost:3000` and at the Vercel URL.

---

## Day 2 — The database and the schema

Today you create the Postgres database and the first two tables. This is the part that plays to your strengths — it is data modeling, which you have done for decades. The only new idea is *where* the access rule lives (see Day 3).

1. **Create a Supabase project** (free tier). Choose a region near you; save the database password it gives you.

2. **Create the first tables.** In the Supabase dashboard, open the SQL editor and run a first migration. Start minimal — the two tables the Add Contact screen needs:
   ```sql
   -- a row per signed-in user is created automatically by Supabase Auth in auth.users

   create table contacts (
     id          uuid primary key default gen_random_uuid(),
     owner_id    uuid not null references auth.users(id) on delete cascade,
     first_name  text,
     last_name   text,
     email       text not null,
     phone       text,
     send_by     text not null default 'email',   -- 'email' | 'text'
     notes       text,
     created_at  timestamptz not null default now()
   );
   ```
   `owner_id` is the hinge: every contact belongs to exactly one user. This is the same tenancy idea as your law-firm work — each firm sees only its own contacts — expressed as a column instead of a separate mapped server.

3. **Connect the app to Supabase.** Install the client and store the project keys as environment variables (never in code):
   ```
   npm install @supabase/supabase-js
   ```
   Create a `.env.local` file (this file is git-ignored — it never leaves your machine) with the two values from Supabase's API settings:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
   Add the same two values in Vercel's project settings so the deployed app has them too.

**End of Day 2 test:** you can insert a row into `contacts` from the Supabase SQL editor and see it in the table viewer.

---

## Day 3 — Auth and the access rule (the important one)

This is the security-model day, and it is the one worth doing carefully. Two pieces: magic-link login, and Row-Level Security.

1. **Turn on magic-link auth.** In Supabase Auth settings, enable email magic links. Supabase handles the token generation, expiry, and verification — you never store a password. This is the same primitive as your WYP recipient link (a signed, short-lived, single-use token in a URL), pointed at your own users instead of external recipients.

2. **Add Row-Level Security (RLS) to `contacts`.** This is the concept to internalize. RLS is a rule *on the table itself* that the database enforces on every query, no matter what the application code does:
   ```sql
   alter table contacts enable row level security;

   create policy "owners see only their contacts"
     on contacts for all
     using ( owner_id = auth.uid() )
     with check ( owner_id = auth.uid() );
   ```
   Read that policy aloud: a user can select, insert, update, or delete a contact row *only* when that row's `owner_id` equals their own authenticated user id. The database refuses everything else. This is the piece that, in a hand-written system, gets missed in one of fifty places and leaks another user's data — here it is one rule in one place, enforced below the application. Given the tenant-isolation work you have already shipped, this will feel familiar; the difference is that the database is doing the enforcing, not your server code.

3. **Wire login into the app.** Add a minimal sign-in page: the user enters an email, you call Supabase's `signInWithOtp`, they click the emailed link, and they return authenticated. Supabase's own docs have the copy-paste Next.js version; this is the one place to follow their guide verbatim rather than improvise.

**End of Day 3 test:** log in as yourself via a magic link; confirm that a query for contacts returns only rows whose `owner_id` is you. Create a second test user and confirm they cannot see the first user's contacts — that is RLS working.

---

## Days 4–5 — Add Contact, wired to real data

Now convert the existing Add Contact mockup into a live screen. You already have the exact markup and styling — `WYP_add_contact_palette1_floating.html` — so this is translation, not design.

1. **Bring the design tokens in.** Copy the contents of `tokens.css` into the app's global stylesheet, and the shared component styles from `components.css`. Your palette, floating labels, and buttons now exist in the app.

2. **Convert the mockup to a component by hand — once.** Take the Add Contact form and rebuild it as a React component. Do this one *manually*, with AI explaining each step rather than generating it, because this is where the declarative model clicks: instead of setting a field's value with a statement, you bind it to a piece of state, and the screen re-renders itself when the state changes. It is a genuine shift from the VB6 "set the control property" model, and doing one by hand is how it lands. After this one, the remaining mockups convert in minutes.

3. **Save a contact.** Wire the Save button to insert a row into `contacts` via the Supabase client. Because RLS is on, you do not write any "is this my data" check in the app — the database enforces it. The `send_by` field is `'email'` for now; the Text option shows the same locked "subscription feature" treatment you just applied to Attachments.

4. **List the contacts.** Below the form (or on a simple list page), read the `contacts` rows back and display them. Seeing a contact you typed persist, survive a refresh, and appear on the deployed Vercel URL is the moment the stack is proven end to end.

**End of week test:** on the live Vercel URL, log in by magic link, add a contact, refresh, and see it persist — with a second account unable to see it.

---

## What you have deliberately *not* touched

Kept off the table on purpose this week, each with a clear later trigger:

- **AWS, and the credits application** — a production concern, revisited only when a beta proves the product and you know your real scale.
- **Email deliverability (SPF/DKIM/DMARC, SES, domain warming)** — a pre-public-launch task. For development and a closed beta, Resend's shared domain is fine; wire Resend in when you first need the app to send a real email (e.g. the request notification), not before.
- **Attachments, payments, SMS, ads** — all deferred by scope: attachments and Request Texting arrive with the paid tier (Supabase Storage → S3; Stripe test mode → live; Twilio with its 10DLC lead time), and ads at 200 users.
- **The secure recipient-response link** — the differentiator, and the piece most worth building carefully. It comes *after* the stack is proven on Add Contact, so you are building the security-sensitive surface on a foundation you already trust.

---

## The one-hour-a-week habit worth keeping

Once the stack is proven, the highest-leverage recurring question is not "what do I build next" but "given where I'm headed, what should I be doing differently that I haven't thought to ask about." That is the question that surfaces the seam issues — the deliverability lead time, the 10DLC registration, the RLS policy you forgot on a new table — before they bite. Ask it out loud at the start of each build week.
