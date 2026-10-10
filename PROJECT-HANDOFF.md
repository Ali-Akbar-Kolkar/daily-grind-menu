# PROJECT HANDOFF PROMPT

> Payment flow update (2026-10-03): This handoff predates the Apps Script payment backend.
> Its EmailJS, QR-generation, and customer "I've paid" instructions are historical and should
> not be used for the current menu. Follow [payment-backend/README.md](payment-backend/README.md)
> and use `payment-backend/Code.gs` with the cart's Apps Script transport instead.

> Copy everything below this line into a new AI session, or read it as the full
> brief for maintaining this project.

---

## The task I was given

Build a cafe menu website for "The Daily Grind" that:

1. Reads the menu from a Google Sheet published as CSV — no backend, no database.
2. Shows a photo for each item.
3. Lets a customer add items to a cart and order.
4. Emails the order to the cafe using EmailJS.
5. Shows a UPI QR code immediately after the order email is sent, for payment.
6. Emails the cafe when the customer clicks "I've paid".
7. Optionally emails a receipt to the customer.
8. Has a private owner-only editor so cafe staff can change the sheet from a phone.
9. Deploys to GitHub Pages with no build step and no npm.

Explicit constraint from the user: **do not add a backend, a database, or a build
step.** EmailJS credentials were to be left as clearly-labelled placeholders and
supplied later.

## Where the code lives

`C:\Users\-\Desktop\my-data\poc` — a git repo, remote
`github.com/Ali-Akbar-Kolkar/daily-grind-menu`, branch `main`, deployed to GitHub
Pages by `.github/workflows/pages.yml`.

A second directory, `C:\Users\-\Desktop\my-data\poc-image-menu`, was the
development sandbox where the image and ordering work was built. It has been
merged into `poc` and is now redundant. **`poc` is the real project.**

## Files

| File | Lines | Role |
|------|-------|------|
| `index.html` | 167 | Page shell, cart drawer, order form, QR/payment step, image test bench |
| `style.css` | 826 | All styling, responsive |
| `script.js` | 524 | Fetches CSV, renders cards, bridges to the cart |
| `order.js` | 1071 | Cart, money, UPI, EmailJS, QR, payment claim |
| `image-urls.js` | 139 | Turns an `Image` cell into a loadable photo URL |
| `site-config.js` | 48 | **The only file to edit to go live** |
| `menu-images.csv` | 18 | Bundled sample sheet (18 rows, Drive photo URLs) |
| `smoke-test.js` | 432 | 83 checks — menu + image URL logic |
| `order-test.js` | 1200 | 360 checks — the entire ordering flow |
| `README.md` | 157 | Customer-facing intro + full technical docs |
| `cafe-menu-dynamic-webpage-spec.md` | 73 | Original spec from the user |
| `cafe-menu-flow-diagram.drawio` / `eco-friendly-paperless-menu.drawio` / `image.png` | — | Diagrams, referenced by the README |
| `owner-editor/Code.gs` | 292 | Apps Script backend, bound to the sheet |
| `owner-editor/Index.html` | 760 | Owner editor UI |
| `owner-editor/appsscript.json` | 9 | V8 manifest |
| `owner-editor/smoke-test.js` | 482 | 77 checks |
| `owner-editor/README.md` | 97 | Deployment instructions |

`installation part/` is deliberately gitignored (large docx/pdf/screenshots).

## Architecture

Plain files, all scripts loaded with `defer` in dependency order:

```
site-config.js → image-urls.js → papaparse (CDN) → emailjs (CDN) → qrcode (CDN) → order.js → script.js
```

`order.js` loads **before** `script.js` so the cart is ready when cards render. If
`order.js` fails to load, the menu still renders with no cart — the site degrades
rather than breaking.

`script.js` was extended with exactly four additive lines versus the original: an
"Add" button in `buildCard`, `CafeOrder.setMenu(items)` after render, and currency
read from config. The CSV parsing and card rendering are untouched.

Third-party code comes from jsDelivr (PapaParse, EmailJS, QRCode.js). There is no
package.json and no lockfile, so a CDN outage removes one feature — and the code
degrades visibly rather than failing silently.

## The ordering flow

1. Each card has an **Add** button.
2. A drawer collects quantities, total always in rupees.
3. **Continue** asks for an email address.
4. The order is emailed to the cafe via EmailJS.
5. A **UPI QR code** appears immediately, encoding the exact total.
6. The customer pays in any UPI app and presses **I've paid**.
7. The cafe is emailed a payment alert. The cart clears only after that send
   succeeds.
8. Optionally the customer gets a receipt email.

`?demo=1` runs the entire flow and sends nothing, logging the would-be payloads to
the console. `owner-editor/?demo=1` does the same for the editor, against 16
in-memory rows.

## Decisions I made that depart from a literal reading of the spec

**The receipt is a separate optional template.** The spec had one "payment
confirmation" template doing double duty. Instead: `paymentTemplateId` goes to the
owner with a fixed To, and an optional `receiptTemplateId` has `To: {{to_email}}`
with the owner on Cc. A failed receipt cannot lose the order, because the owner's
alert has already gone.

**The order email has no `to_email` variable at all.** Each EmailJS template's To
field decides the recipient, so if the order template's To were ever pointed at
`{{to_email}}` the order would go to the customer instead of the cafe. Removing the
variable makes that structurally impossible rather than merely documented.

**Money is integer paise everywhere.** `am=` in the UPI link is never
`9.900000000000001`. The same string is used in the email, the QR, the "Open UPI
app" button and the clipboard copy, and tests assert all four are byte-identical —
a QR showing one amount while the email says another is the failure mode that
loses money.

**`?demo=1` was added** even though the spec didn't ask, matching the existing
`owner-editor` convention.

## Bugs the tests caught in my own code

Worth knowing, because each was a real defect and each has a regression test:

1. **An item deleted from the sheet reported "Your cart is empty"** to the
   customer. The empty-cart check ran before the menu-change check. Reordered.
2. **Changing a quantity destroyed keyboard focus.** The whole list re-rendered, so
   the button you had just pressed no longer existed. Now the single row is
   patched in place; removing a row moves focus deliberately to another remove
   control or the drawer close button.
3. **`sdkReady()`/`qrReady()` returned `undefined`** instead of `false`.
4. **The shipped UPI placeholder passed validation.** `site-config.js` contained
   `vpa: 'yourname@okaxis'` and the placeholder detector looked for `XXXX`/`YOUR_`,
   which it matched neither of. So `upiReady()` returned true. Had the EmailJS keys
   been filled in while that line was left alone, the site would have generated a
   working QR code pointing at **a stranger's UPI ID** and written the same link
   into the order email. Fixed three ways: `vpa` now ships **empty**; the detector
   catches the shapes people actually type (`_X1234@bank`, `YOURNAME@bank`,
   `yourname@bank`); and `upiLink()` re-checks independently of the UI so no code
   path can emit a QR built from a placeholder. The trade-off is deliberate — a
   false positive means ordering is refused, which is harmless next to sending
   money to a stranger.
5. **`receiptTemplateId` was documented but missing from `site-config.js`.**

## Two problems the merge would have caused

Found while merging `poc-image-menu` into `poc`. Both were silent.

**The deploy would have deleted the ordering config.** `pages.yml` regenerated
`site-config.js` from scratch on every push, writing only the CSV URL line. That
would have wiped `MENU_CURRENCY` and the entire `CAFE_ORDER` block on the next
commit — cart defaulting to USD, ordering off with no clue why. The workflow now
replaces **only** the `window.MENU_CSV_URL` line via a targeted regex, and throws
if that line is absent, so a broken config fails the deploy loudly instead of
publishing. Verified in three cases: variable set, variable unset, line missing.

**The developer test bench was visible to customers.** It sat above the menu. It is
now `hidden` in the HTML and revealed only by `?bench=1`, or automatically when
`index.html` is opened from disk so the local workflow is unchanged. Five tests pin
this.

Also restored during the merge, because `poc-image-menu` had lost them: the
portfolio credit in the footer, the real cafe branding ("Est. 2019 · Open
7am–4pm", "Small batch, slow poured, baked this morning"), and the `<title>` and
meta description. The meta description had been replaced with "Proof of concept:
reading item photos from an Image column…", which is what would have appeared in
Google results.

## Photos

Add an `Image` column to the sheet containing either a full URL or a bare Drive
file ID. `image-urls.js` probes five URL forms in order and uses the first that
loads.

`=IMAGE()` in a Google Sheet exports a usable `encrypted-tbn0.gstatic.com`
thumbnail URL — verified HTTP 200, 47,096 bytes, `image/jpeg`. But it is an
undocumented, small `s=10` cache token that may rotate or expire, so it is not
reliable for production. Drive is not a CDN and the `uc?export=view` form has been
unreliable since 2024 due to third-party cookie changes.

## The UPI QR

```
upi://pay?pa=<your UPI ID>&pn=<payee name>&am=<total>&cu=INR&tn=Order <id>&tr=<id>
```

Built client-side, no gateway, no fee. If the QR library fails to load, the page
says so and still offers the working "Open UPI app" button, so a CDN outage
cannot stop someone paying.

## Guard rails, because the endpoint is public

EmailJS keys in browser JavaScript are public by design. What protects the account
is the dashboard settings plus these client-side limits:

- a hidden **honeypot** field, so naive bots see a success and send nothing. It uses
  `clip-path: inset(50%)` rather than `left: -9999px`, so it cannot appear in
  screenshots, print, or anything that reads the page's text.
- a **15 second cooldown** between orders from the same browser
- caps of **20 per item** and **30 different items**, which also bounds email size
- the **cart is never cleared on failure** — only after the cafe's payment alert
  has actually gone out, so a failed send is always retryable
- menu refreshes re-price the cart and flag deleted items; a deleted item stays
  visible, blocks sending until removed, and never enters the total
- all order DOM is built with `textContent`, never HTML interpolation

The real protection is EmailJS's **allowed origins** list. Without it, anyone can
burn the ~200 emails/month free tier from a script.

## Running the checks

```
node smoke-test.js          # 83 checks, exit 0
node order-test.js          # 360 checks, exit 0
cd owner-editor && node smoke-test.js   # 77 checks, exit 0
```

Both harnesses run the real files in a Node `vm` sandbox against a stub DOM, fake
`localStorage`, fake EmailJS and fake QRCode. No browser, no network. Image
loading is stubbed at `MenuImages.probeImage`, so the fallback ordering is
genuinely exercised rather than assumed.

The menu suite derives its counts and tallies from `menu-images.csv`, so it does
not need editing when rows change.

## What is NOT done, and what is honestly limited

- **Payment is not verified.** "I've paid" is the customer's claim. The owner must
  check their UPI app. The total is computed in the browser, so someone with
  devtools could change it — a tampered total would appear in the QR *and* the
  email, so it would be at least internally consistent, but wrong. Real
  verification needs a gateway (Razorpay/PayU/Cashfree) with merchant KYC and a
  server-side webhook, which reintroduces the backend this design avoids.
- **No login.** Anyone with the link can order, which suits a table QR code.
- **The receipt is not stored.** A refresh after paying empties the cart, but the
  cafe has both emails.
- **EmailJS free tier is ~200 emails/month** and each completed order sends two, so
  roughly 100 orders.
- **The live sheet has no `Image` column yet.** The new card code handles a
  missing column fine, so nothing is broken, but the photo feature stays invisible
  until the column is added to the sheet that `gid=810010135` publishes.
- **Ordering is switched off.** `site-config.js` still has placeholder EmailJS
  values and an empty `upi.vpa`. The cart works; "Send order" refuses. With
  placeholders the on-screen message stays vague on purpose, and the browser
  console names every unset value by its exact key so you are not left guessing
  which line to edit.
- **The repo is public**, so `owner-editor/Code.gs` and the sheet's column
  structure are readable by anyone. Consistent with the rest of the repo being
  public, but keeping the editor source private would need a separate private repo.

## Go-live checklist

1. Add an `Image` column to the live sheet, and put URLs or Drive file IDs in it.
2. EmailJS: create the **New order** and **Payment claimed** templates, both with
   the cafe's address typed into **To**. Optionally a **receipt** template with
   `To: {{to_email}}` and the cafe on Cc.
3. EmailJS → Account → Security → add the site domain to **Allowed Origins**.
4. Fill `window.CAFE_ORDER` in `site-config.js`: `serviceId`, `orderTemplateId`,
   `paymentTemplateId`, `publicKey`, and `upi.vpa`. Keep `vpa` empty until you have
   the real UPI ID.
5. Commit and push. Nothing is committed yet.

## Repository state at handoff

The working tree has changes staged in the working directory only, **nothing
committed and nothing pushed**:

```
 M .github/workflows/pages.yml
 M README.md
 M index.html
 M script.js
 M site-config.js
 M smoke-test.js
 M style.css
?? .gitignore
?? image-urls.js
?? menu-images.csv
?? order-test.js
?? order.js
?? owner-editor/
```

Before the merge the tracked tree was clean, so `git checkout .` reverts every
tracked change if this direction is wrong.
