# Connecting Outlook / Hotmail — the one-time Azure registration

Microsoft turned off password sign-in for Outlook/Hotmail/Live over IMAP/SMTP in September
2024, and app passwords don't work either. **OAuth is the only way in**, and OAuth needs a
**client ID** that you register once. Free, ~10 minutes, done once for the whole product.

---

## Read this first — it saves the two mistakes people make here

**1. The registration is not tied to your mailbox.** A client ID identifies *the
application* — Workspace OS — not an account. You are not "connecting hotmail to Azure". You
are registering the app once, and *then* signing into it as whoever you like. So it does not
matter which Microsoft account you use to register: an ID registered under any account will
happily sign in `you@hotmail.com`, as long as you pick the right account type in
step 3.

**2. This costs nothing and needs no Azure subscription.** App registrations live in Microsoft
Entra ID, not in a paid Azure subscription. If you are asked for a credit card, you have
wandered into creating an Azure *subscription* — you do not need one. Back out.

---

## If the portal refuses to let you in

You may hit this on the way to step 1:

> Selected user account does not exist in tenant 'Microsoft Services' and cannot access the
> application 'c44b4083-3bb0-49c1-b47d-974e53cbdf3c' in that tenant.

**This is not a permissions problem and not a missing subscription.** That GUID is the Azure
Portal's *own* application ID, and the message means your sign-in got scoped to a tenant your
personal account isn't a member of. Fixes, in the order worth trying:

1. **Use a private/incognito window** and go to **https://entra.microsoft.com** (the Microsoft
   Entra admin center) rather than portal.azure.com. This is the most reliable route for a
   personal Microsoft account, and it has the same App registrations section.
2. If you were already signed in somewhere, **sign out of all Microsoft accounts first** —
   a stale session is what pins the wrong tenant.
3. Still stuck? **Register from a different Microsoft account** — a work account, or a new
   free one. Per point 1 above, the resulting client ID still works for your hotmail address.

---

## Step 1 — Create the app registration

1. Go to **https://entra.microsoft.com** (or portal.azure.com if it lets you in).
2. In the left menu: **Applications** → **App registrations** → **+ New registration**.
3. Fill in the form:

   | Field | What to enter |
   |---|---|
   | **Name** | `Workspace OS Mail` — this is what users see on the consent screen, so make it presentable. |
   | **Supported account types** | ⚠️ **"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"** |
   | **Redirect URI** | Platform: **Public client/native (mobile & desktop)** → value: `http://127.0.0.1` ⚠️ **not** `http://localhost` — see step 2 |

   **The account-types choice is the single most important field on this page.** Pick any of
   the narrower options and your Hotmail address will be rejected at sign-in with "account
   does not exist in this tenant" — the same class of error as above, but this time caused by
   your own registration.

4. Click **Register**.

---

## Step 2 — Allow public client flows

This is the second trap. Without it, sign-in fails at the token step with a demand for a
client secret that a desktop app cannot safely hold.

1. In your new app, left menu → **Authentication**.
2. Scroll to the bottom: **Advanced settings** → **Allow public client flows**.
3. Set it to **Yes**.
4. **Save.**

### ⚠️ The redirect URI must be `http://127.0.0.1`, not `http://localhost`

While you're on this page, check the redirect URI under **Mobile and desktop applications**.
It must be **`http://127.0.0.1`**. Registering only `http://localhost` fails at sign-in with:

> invalid_request: The provided value for the input parameter 'redirect_uri' is not valid.

Microsoft ignores the **port** on a loopback redirect but *not* the **host**, and it treats
`localhost` and `127.0.0.1` as two different URIs. Workspace OS binds the loopback listener
to `127.0.0.1` (`src/main/mail/oauth/oauth-flow.ts`) and therefore requests
`http://127.0.0.1:<random-port>`. That is deliberate: `localhost` can resolve to IPv6 `::1`
and then fail to match the socket the app actually bound.

So register `http://127.0.0.1`. You do **not** need to register a port — any port is
accepted. Keeping `http://localhost` alongside it is harmless.

**No client secret is needed. Do not create one.** The flow is PKCE; a desktop app has
nowhere to hide a secret, which is exactly why PKCE exists.

---

## Step 3 — Add the mail permissions

1. Left menu → **API permissions** → **+ Add a permission**.
2. Choose the **APIs my organization uses** tab → search for **Office 365 Exchange Online**
   → open it → **Delegated permissions**, and check:
   - `IMAP.AccessAsUser.All` — read mail
   - `SMTP.Send` — send mail
3. **Add permissions.**
4. Add a second permission → **Microsoft Graph** → **Delegated permissions**, and check:
   - `offline_access` — this is the one that grants a **refresh token**. Without it you get
     signed out roughly every hour.
   - `openid`, `email`, `profile`
5. **Add permissions.**

You do **not** need to click "Grant admin consent" — that button is for organisational
tenants. As a personal account you consent for yourself, in the browser, at sign-in.

---

## Step 4 — Copy the client ID

1. Left menu → **Overview**.
2. Copy the **Application (client) ID**. It is a GUID and looks like
   `1a2b3c4d-5e6f-7890-abcd-ef1234567890`.

**Copy the Application (client) ID — not the Object ID and not the Directory (tenant) ID.**
All three sit next to each other on that page and all three are GUIDs, so this is easy to get
wrong. Workspace OS validates the shape but cannot tell one GUID from another.

---

## Step 5 — Give it to Workspace OS

**Just send the client ID to Claude** and it gets pasted into
`src/main/mail/oauth/client-config.ts` as the shipped default, which is the intended end
state — nobody else should ever have to do any of the above.

Two other routes exist, both of which override the shipped default:

- **In the app:** Mail → Add account → Outlook preset → paste it into the client-ID field.
  Stored at `~/Library/Application Support/Workspace OS/microsoft-oauth.json`.
- **Env var:** `MICROSOFT_OAUTH_CLIENT_ID=<the-guid>` before launching. Wins over everything.

---

## Step 6 — Connect

1. **Mail → Add account → Outlook** preset → **Sign in with Microsoft**.
2. A browser window opens. Sign in as `you@hotmail.com` and approve the consent
   screen — it lists the permissions from step 3, under the app name from step 1.
3. Done. The refresh token is encrypted via the OS keychain (`safeStorage`); access tokens
   refresh automatically. No password is ever stored.

---

## If sign-in fails

| Symptom | Almost always means |
|---|---|
| "account does not exist in this tenant" *at sign-in* | Step 1 account types — not set to include **personal Microsoft accounts**. Change it on the app's **Authentication**/overview page; no need to re-register. |
| A client-secret error, or `AADSTS7000218` | Step 2 — **Allow public client flows** is still No. |
| Signed out after ~an hour | Step 4 — `offline_access` missing, so no refresh token was issued. |
| "invalid client" | Wrong GUID — likely the Object ID or tenant ID instead of the **Application (client) ID**. |
| `invalid_request … 'redirect_uri' is not valid` | Step 2 — `http://127.0.0.1` is not registered. `http://localhost` alone does **not** cover it; Microsoft matches the host, only the port is ignored. |
| Redirect/reply-URL mismatch | Step 1 — the redirect URI must be registered under **Mobile and desktop applications**, not Web. |

---

## Meanwhile — testing mail without any of this

**Gmail with an app password** works today with zero setup and exercises the entire mail
stack: IMAP read, SMTP send, compose, rich mode, live `{{metric:id}}` values, and
agent-drafted replies. Google Account → Security → 2-Step Verification → App passwords.
