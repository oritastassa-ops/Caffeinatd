# 20 · Notifications setup runbook

Operational checklist to take the notification pillar from "built" to "delivering."
Follow in order. Each step has a verification you must pass before moving on.

Estimated time: 20–30 minutes, most of it waiting on Resend DNS or clicking through dashboards.

---

## Step 0 — Confirm starting state

Open Terminal.

```bash
cd ~/Desktop/Caffeinatd
git log --oneline -1
```

**Expect:** a commit hash and message. If it says `49916d9` or later, you're current.

```bash
ls supabase/migrations/
```

**Expect** to see, among others: `008_notifications.sql`, `009_sms.sql`,
`010_reminders_dispatch.sql`, `011_inbound.sql`.

If any are missing, stop — the code isn't checked out correctly.

---

## Step 1 — Apply the four migrations

These create every table the notification system reads and writes. Nothing works before this.

1. Open a browser to **https://supabase.com/dashboard**
2. Click your Caffeinatd project.
3. If the project shows a **"Restore project"** button, click it and wait ~2 minutes. Free-tier
   projects pause after about a week idle.
4. In the left sidebar, click **SQL Editor**.
5. Click **New query** (top right).

Now repeat this sub-loop **four times, in this exact order**:

| Pass | File |
|---|---|
| 1 | `supabase/migrations/008_notifications.sql` |
| 2 | `supabase/migrations/009_sms.sql` |
| 3 | `supabase/migrations/010_reminders_dispatch.sql` |
| 4 | `supabase/migrations/011_inbound.sql` |

For each pass:

- In Terminal: `cat supabase/migrations/008_notifications.sql | pbcopy`
  (substitute the filename each pass — `pbcopy` puts it on your clipboard)
- In the SQL Editor query box: click inside, press **⌘A** then **⌘V** to replace with the file
- Click **Run** (or press **⌘Enter**)

**Expect after each:** `Success. No rows returned`.

**If you see `relation "X" already exists`:** that migration was already applied. Safe to ignore,
move to the next pass.

**If you see any other error:** stop and report it. Do not run later migrations.

### Verify Step 1

In the SQL Editor, run this:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name like 'notification%' or table_name = 'inbound_messages'
order by table_name;
```

**Expect at least:** `inbound_messages`, `notification_contacts`, `notification_deliveries`,
`notification_preferences`, `notification_spend`.

If any are missing, the corresponding migration did not apply. Go back.

---

## Step 2 — Get a Resend API key

1. Open **https://resend.com** → **Sign up** (free tier is enough).
2. After signing in, click **API Keys** in the left sidebar.
3. Click **Create API Key**.
4. Name: `caffeinatd-local`. Permission: **Full access**. Click **Add**.
5. **Copy the key immediately** — it starts with `re_` and is shown exactly once.

### Choose your sender address

You have two options. Pick one.

**Option A — fastest, zero DNS (recommended to start):**
Sender is `onboarding@resend.dev`. Resend allows this without domain verification, but it will
**only deliver to the email address on your Resend account**. That's fine for proving the system
works. Use exactly:

```
NOTIFICATIONS_FROM_EMAIL=Caffeinatd <onboarding@resend.dev>
```

**Option B — a domain you own:**
In Resend, click **Domains** → **Add Domain** → enter your domain → add the shown DNS records
(SPF and DKIM) at your registrar → wait for **Verified**. Then use
`Caffeinatd <you@yourdomain.com>`. This removes the recipient restriction.

Start with Option A. Move to B later.

---

## Step 3 — Generate the signing secret

In Terminal:

```bash
openssl rand -hex 32
```

**Expect:** a 64-character hexadecimal string. Copy it.

---

## Step 4 — Edit `.env`

**These four keys are not in `.env` by default** — they exist only in `.env.example`. You are
adding them, not editing them.

Append the block (this also generates the Step 3 secret inline, so you can skip Step 3):

```bash
cd ~/Desktop/Caffeinatd
printf '\nNOTIFICATIONS_DRIVER=live\nNOTIFICATION_SECRET=%s\nRESEND_API_KEY=PASTE_YOUR_RESEND_KEY_HERE\nNOTIFICATIONS_FROM_EMAIL=Caffeinatd <onboarding@resend.dev>\n' "$(openssl rand -hex 32)" >> .env
```

Then open the file and replace the one placeholder:

```bash
open -e .env
```

Scroll to the bottom, replace `PASTE_YOUR_RESEND_KEY_HERE` with your `re_...` key from Step 2.

**`NOTIFICATIONS_DRIVER` must be exactly `live`** — not `resend`. `live` is the switch that turns
on real vendors; `logging` routes everything to a console stub that sends nothing.

Rules:

- No quotes around any value.
- No spaces around the `=`.
- Do not add a `#` comment on the same line as a value.

Save with **⌘S**, close TextEdit.

### Verify Step 4

```bash
grep -E '^(NOTIFICATIONS_DRIVER|NOTIFICATION_SECRET|RESEND_API_KEY|NOTIFICATIONS_FROM_EMAIL)=' .env \
  | sed 's/=.\{0,6\}.*/= [set]/'
```

**Expect:** four lines, each ending `= [set]`. If a line is missing, it isn't set.

---

## Step 5 — Restart the dev server

Next.js reads env at boot. A running server will not pick up your changes.

In the Terminal window running `npm run dev`: press **Ctrl-C**.

Then:

```bash
npm run dev
```

**Expect:** `✓ Ready in ...` and a local URL.

**If you see a compile error:** stop and report it.

---

## Step 6 — Sign in

1. Browser → **http://localhost:3000**
2. If you land on the login page, use the password you set via the admin API — click
   **"Sign in with a password"**, enter your email and password, click **Sign in**.
3. If magic link is working again, use that instead.

**Expect:** the Today dashboard.

---

## Step 7 — Add and verify your email contact

1. Navigate to **http://localhost:3000/settings/notifications**

**Expect:** a page with a Contacts section. If it errors, a migration from Step 1 didn't apply.

2. In Contacts, add your email address. If you chose Option A in Step 2, this **must be the email
   on your Resend account** — nothing else will deliver.
3. Click to send the verification code.
4. Check your inbox. **Expect** a 6-digit code within about a minute.
5. Enter the code on the settings page.

**Expect:** the contact shows as verified.

**If no email arrives after 2 minutes:** check the Terminal running `npm run dev` for a line
prefixed `[notifications:email]`. That's the real error. Most common causes: wrong sender format,
recipient isn't your Resend account email, or `NOTIFICATIONS_DRIVER` isn't `live`.

---

## Step 8 — Test send

On the same page, click **Test send** for the email channel.

**Expect:** a real email arrives, and a row appears in the delivery log showing `sent`.

**This is the moment the whole pillar is proven.** If it works, everything downstream —
daily plans, reminders, insights — uses the same path.

---

## Step 9 — Prove the queue and worker

Test send is synchronous. This step proves the asynchronous path.

1. In the app, press **⌘K**.
2. Type: `remind me to check the notification queue in 2 minutes`
3. Press Enter. **Expect** a confirmation receipt.

Wait 2 minutes. The cron only runs on Vercel, so trigger the worker manually. In a **new** Terminal
tab:

```bash
cd ~/Desktop/Caffeinatd
CRON=$(grep '^CRON_SECRET=' .env | cut -d= -f2- | awk '{print $1}')
curl -s -H "Authorization: Bearer $CRON" http://localhost:3000/api/cron/notifications
```

**Expect:** JSON like `{"claimed":1,"sent":1,"failed":0,"retried":0}` and the reminder email
arrives.

**If `claimed` is 0:** the reminder isn't due yet, or it was queued outside its send window. Check
the delivery log on the settings page.

Run the same curl a second time. **Expect** `{"claimed":0,...}` — proof that dedupe works and
nothing double-sends.

---

## Step 10 — Before deploying to Vercel

Do not skip this. `vercel.json` currently registers the notification worker at `*/5 * * * *`.
**Vercel Hobby accounts only allow cron expressions that run once per day; anything more frequent
fails the deployment.**

Run `prompts/10-operational-polish.md` in Claude Code, which resolves this and documents the
alternatives (Vercel Pro, or an external scheduler hitting the `CRON_SECRET`-protected endpoint).

Also: set every env var from Step 4 in the Vercel project settings, plus `APP_URL` pointing at the
production URL. Do **not** set `NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN` in Vercel.

---

## Failure quick-reference

| Symptom | Cause | Fix |
|---|---|---|
| `fetch failed` on every page | Supabase project paused | Restore it in the dashboard |
| Settings page 500s | Migration not applied | Redo Step 1 |
| Test send does nothing, no error | `NOTIFICATIONS_DRIVER` is `logging` | Set it to `live`, restart |
| Email queued but never sent | Sender domain unverified, or recipient isn't your Resend account email | Step 2, Option A rules |
| "Email rate limit exceeded" on login | Supabase built-in SMTP caps at 2/hour | Wait an hour, or set Resend as Supabase custom SMTP |
| Env change has no effect | Server not restarted | Ctrl-C, `npm run dev` |
