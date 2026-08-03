# WYP — Everyday workflow

Short reference for the actions that come up repeatedly. Run everything from
`C:\Project\wyp`.

---

## Local development

```bash
npm run dev            # start at http://localhost:3000
Ctrl + C               # stop the server
```

**Most edits need no restart.** Saving a `.tsx` or `.css` file hot-reloads in
the browser within a second. Restart the dev server only after:

| You changed | Why a restart is needed |
|---|---|
| `.env.local` | Environment variables are read once, at boot |
| `next.config.ts` | Framework config is read once, at boot |
| `package.json` / installed a package | New dependency isn't in the running process |
| `tsconfig.json` / `postcss.config.mjs` | Build pipeline config is read once |

If the page looks stale or a change refuses to appear, stop the server, delete
the `.next` folder, and start again. That clears the build cache.

---

## Before pushing

```bash
npx tsc --noEmit       # fast — catches type errors in seconds
npm run lint
npm run build          # the real check; MUST pass
```

`npm run build` is the one that matters, because **Vercel runs it on every push
and a failure means a failed deploy**. It typechecks every file matched by
`tsconfig.json`, not just the ones your routes import — which is how a retired,
unused file broke the build on 2026-08-02.

---

## Commit and deploy

Deploying is a side effect of pushing. There is no separate deploy step.

```bash
git status             # see what changed
git add -A             # stage everything, including new files
git commit -m "short description of the change"
git push               # Vercel builds and deploys automatically
```

Then watch the build at vercel.com → the `wyp` project → Deployments.

**Deploy is not the same as commit.** Clicking *Redeploy* in the Vercel
dashboard rebuilds the **last commit** — it cannot see uncommitted files on
your machine. If the site doesn't show your change, check the commit SHA on the
deployment against `git log --oneline -1`.

**Commit before deleting anything.** Git can only restore what it has already
seen. A file that was never committed is gone for good once deleted.

---

## Environment variables

| Where | How to apply the change |
|---|---|
| `.env.local` (local only) | Restart `npm run dev` |
| Vercel → Settings → Environment Variables | Redeploy; existing deployments keep the old values |

`.env.local` is git-ignored and must stay that way — which also means it never
reaches Vercel. Every variable the app needs must be entered in Vercel
separately.

Two things that have already caused a failed deploy (2026-08-03):

- **Scope.** Variables are set per environment. `vercel env pull` writes the
  *Development* set, so a variable can be present locally and absent from
  Production. Tick Production and Preview.
- **Exact name.** The code reads `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is a different variable and will not
  be found.

`NEXT_PUBLIC_*` is visible in the browser — never put a secret behind that
prefix. The `service_role` key never belongs in either place.

---

## Database changes

1. Run the SQL in the Supabase SQL editor.
2. Paste it into `docs/SQL history .txt` with the date.
3. Verify the policy **from the browser or as `anon`** — the SQL editor runs as
   superuser and bypasses RLS entirely, so a query succeeding there proves
   nothing about what your app can see.

Every new table needs `enable row level security` **and** policies for all four
verbs. A table with only an INSERT policy accepts writes and returns zero rows
on read, with no error.

---

## Supabase auth

- Redirect targets must be registered under Authentication → URL Configuration,
  including `http://localhost:3000/**`.
- Magic links expire in 1 hour, work once, and are limited to one per user per
  60 seconds.
- The built-in email sender is tightly rate limited. Repeated sign-in testing
  will hit the cap; raising it requires custom SMTP, not a dashboard toggle.

---

## Recovering something

```bash
git log --oneline                          # find the commit
git show <sha>:path/to/file                # view an old version
git checkout <sha> -- path/to/file         # restore it
git restore path/to/file                   # undo uncommitted edits to a file
```

---

## Design changes

Screens are designed as static HTML in `design/screens/`, approved, then
converted to React. Do not invent UI directly in `.tsx`. Update the status
table in `design/README.md` when a screen is converted.
