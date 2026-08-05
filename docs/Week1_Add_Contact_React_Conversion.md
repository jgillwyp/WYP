# Add Contact — mockup to component, and the schema it now writes to

Reference for Week 1, Days 4–5 of `WYP_Week1_Setup.md`: converting the Add
Contact mockup to a React component and wiring Save to `contacts`. Written
after the fact, so it also reconciles the setup doc's original schema against
what migration 002 actually left in place — that's the "refinement" you
remembered.

New files: `app/components/AddContactForm.tsx`, `app/contacts/new/page.tsx`.
Edited: `app/globals.css` (missing chip/phone styles), `design/README.md` and
`CLAUDE.md` (status and known-gaps updates — see the end of this doc).

---

## The declarative shift, concretely

In the static mockup, and in a VB6 form, a field's value is a property you
set once and then mutate on demand: `Text1.Text = ""`, then later
`Text1.Text = someValue`. The value lives *in the control*, and your code
reaches in to change it.

In `AddContactForm.tsx` the value lives in one place — a plain object in
React state:

```tsx
const [form, setForm] = useState<ContactFormState>(initialState)
```

`form.firstName` is the single source of truth. The `<input>` doesn't hold
its own value the way `Text1` does; it's "controlled":

```tsx
<input
  className="finput"
  value={form.firstName}
  onChange={(e) => set('firstName', e.target.value)}
/>
```

`value={form.firstName}` means the box always displays whatever `firstName`
currently is — you never assign into the box directly. `onChange` fires on
every keystroke and writes that keystroke back into state. The function
component itself — `AddContactForm` — reruns every time state changes, and
returns JSX describing what the screen should look like *now*. React diffs
that against the real DOM and patches only what changed. There's no line
anywhere that says "put this text in that box"; there's only "this is what
state is," and the screen follows.

This is why the floating-label CSS still works unmodified: it keys off
`:not(:placeholder-shown)`, a DOM/CSS mechanism, and a controlled input's DOM
value is still the real value — React isn't hiding it. The label float and
the state binding are two independent mechanisms that happen to observe the
same input.

The one field this pays off most visibly on is the Email chip:

```tsx
<button className={`chip${sendBy === 'email' ? ' selected' : ''}`} ...>
```

`sendBy` is state, currently pinned to `'email'` because Text isn't legal
yet. The chip's `selected` class is a *read* of state, not a hardcoded
className. The day Text unlocks, this line doesn't change — only what sets
`sendBy` does.

## Mapping the mockup

| Mockup (`WYP_add_contact_palette1_floating.html`) | Component |
|---|---|
| `<input class="finput" ... placeholder=" ">` | Controlled `<input value={...} onChange={...}>`, same classes, same markup order (input then label — the float depends on it) |
| Static `value="roman.atley@example.com"` on the email field | Removed. That was a mockup fixture for visual review, not a real default. |
| `.chip` / `.chip.selected` on Send Requests by | Same classes, `selected` now driven by `sendBy === 'email'` |
| `.chip.is-locked` on Text | Unchanged — the mockup already carries the current `is-locked` treatment (§6.22), lock glyph and `aria-disabled="true"` included. Nothing to invent here. |
| Save / Cancel buttons in `.band` | `type="submit" form="add-contact-form"` / `type="button"` with a `router.push('/')` handler. They sit in `.band`, outside the `<form>`, exactly as in the mockup — the `form` attribute is what still lets Save submit it. |
| No validation in the mockup | `nameInvalid` / `emailInvalid` state, `.is-invalid` class, `.ferror` messages — same pattern already used in `app/login/page.tsx`, reused rather than invented |

`.sendrow`, `.chippair`, `.chip`, `.gatenote`, `.phone-row`, and `.ccode`
existed only inside the mockup's own `<style>` block — `globals.css` didn't
have them yet, because no screen had used them before. They're ported in now,
placed after the checkbox-row section, same as every other shared component
class.

## Save, and why there's no permission check to write

```tsx
const { data: userData } = await supabase.auth.getUser()

await supabase.from('contacts').insert({
  owner_id: userData.user.id,
  first_name: form.firstName.trim() || null,
  last_name:  form.lastName.trim()  || null,
  email:      form.email.trim(),
  phone:      form.phone.trim() || null,
  send_by:    sendBy,
  notes:      form.notes.trim() || null,
})
```

`owner_id` is set here so the row is populated correctly — that line is data
entry, not security. The policy that makes this safe lives on the table, not
in this file:

```sql
create policy "Allow individual insert"
  on contacts for insert to authenticated
  with check (auth.uid() = owner_id);
```

If this component sent the wrong `owner_id`, or a modified client tried to,
Postgres would reject the insert. There's nothing to add here even if you
wanted to double-check — that's the point of RLS versus an app-level "is this
mine" branch.

One nuance from `docs/SQL history .txt`: at one point `owner_id` was given
`default auth.uid()` at the column level, which would let an insert omit
`owner_id` entirely and have Postgres fill it in from the caller's JWT. That
default may still be in place. This component sets `owner_id` explicitly
anyway — it's one line, it's self-documenting for the next person reading
this file cold, and it doesn't ask you to remember an unverified column
default that was only ever exercised from the SQL editor (where, per the
migration's own warning, `auth.uid()` is null and that default would fail).
Worth confirming in the Supabase dashboard which way it's actually set, but
it doesn't change what this component does either way.

## What actually changed since `WYP_Week1_Setup.md`

The setup doc's Day 2 schema is the starting shape — still accurate for the
columns. What's moved is the policies and one added table, all in
`docs/migrations/002_profiles_contacts_events.sql`, run and verified
2026-08-03:

`contacts` had only the INSERT policy from Day 3 of the setup doc. Migration
002 added SELECT, UPDATE, and DELETE — each scoped `owner_id = auth.uid()`,
same shape, one policy per verb rather than the setup doc's single `for all`
policy. Practical effect on this step: none — Save only inserts. It matters
for the next step, listing contacts, which needs SELECT and would have
silently returned zero rows without it (RLS enabled with no matching policy
denies; that was flagged as a known gap in `CLAUDE.md` before this migration
and is resolved now).

`contacts` also gained `linked_user_id`, unused today — it'll let a
recipient who's signed in be recognised as an existing account rather than
always arriving through a token link.

A new `profiles` table exists alongside `contacts`: one row per user, holding
`tier` (`free` / `subscriber`, column-grant-protected so a user can't
promote themselves) and `notify_by`. Not read by this component — Text stays
locked outright because SMS delivery isn't built, not because of tier — but
it's the mechanism that will eventually gate the Text chip instead of a
hardcoded lock.

An `events` audit table was also added, RLS-enabled with no policies yet
(denies everything until the `requests` table exists in a later migration).
Not used by Add Contact.

## What this pass doesn't do

Save only. The list view below the form (setup doc step 4) isn't built —
after Save, this redirects to `/`, which is still the placeholder home page.
To confirm an insert landed, use the Supabase table editor for now, the same
end-of-Day-2 test as the setup doc.

The no-contact interception dialog
(`design/screens/WYP_add_contact_no_contact_dialog_palette1.html`) is a
separate flow triggered from Create Request, which isn't converted yet
either. Out of scope here.

The phone country-code button is inert — same as the mockup, no dropdown
behind it. Both gaps are recorded in `CLAUDE.md` under Known gaps, along with
the Add Contact status change (Mockup → Converted) also reflected in
`design/README.md`'s screen table, per that file's own rule to update it on
conversion.

## Try it

```bash
npm run dev
```

Sign in at `/login`, then visit `/contacts/new`. Save with the name/email
minimum met should insert a row and return you to `/`; check it landed in
Supabase's table editor under `contacts`, owned by your user id. A second
signed-in account should not be able to select it — that's the RLS policies
from migration 002, not anything in this component.
