# Eco-Friendly, Paperless & Plastic-Free Menu

A digital cafe menu that helps reduce repeated paper printing and plastic menu sleeves. Cafe staff update menu items, prices, and availability in a Google Sheet; customers scan a QR code to view the current menu on their phones.

## How It Works

![Diagram showing the cafe team updating a Google Sheet that syncs to a live digital menu for customers](image.png)

1. Cafe staff update the menu in the Google Sheet.
2. The published sheet feeds the live menu webpage.
3. Customers scan the cafe's QR code and view the menu on their phones. No app download is required.
4. Customers can add items to a cart and order by email. The cafe replies with its own UPI QR code.

The menu is publicly viewable. Only people authorized by the cafe can edit the Google Sheet.

## Demo

[View the live menu](https://ali-akbar-kolkar.github.io/daily-grind-menu/)

## Diagram Source

[Open or download the editable Draw.io diagram](eco-friendly-paperless-menu.drawio)

---

# Development notes

Everything below is for whoever maintains this, not for customers.

## How the site is built

No build step, no bundler, no server. It is plain files deployed by GitHub Actions
(`.github/workflows/pages.yml`) to GitHub Pages.

| File | Role |
|------|------|
| `site-config.js` | The only file you edit to go live. Sheet URL, currency, and EmailJS keys. |
| `index.html` | Page shell, cart drawer, order form, and the image URL test bench. |
| `script.js` | Fetches the CSV, renders menu cards. |
| `image-urls.js` | Works out a loadable photo URL from whatever the `Image` column holds. |
| `order.js` | Cart, totals, EmailJS order and payment-claim messages. |
| `style.css` | All styling. |
| `menu-images.csv` | Bundled sample sheet, used when `MENU_CSV_URL` is blank. |
| `owner-editor/` | Private Google Apps Script editor so the owner can change the sheet from a phone. |

Scripts load with `defer` in dependency order, so `order.js` is in place before `script.js`
runs. If `order.js` fails to load, the menu still renders and there is simply no cart.

Third-party code is loaded from jsDelivr: PapaParse and EmailJS. There is no npm install and no
lockfile; if a CDN breaks, the page loses that one feature and says so rather than failing silently.

## Photos come from the sheet

Add an `Image` or `Image URL` column to the sheet and put either a full URL or a bare Google Drive
file ID in it. `image-urls.js` turns that into something a browser will actually load, trying
several URL forms in order.

`=IMAGE()` in a Google Sheet exports a usable `encrypted-tbn0.gstatic.com` thumbnail URL — it was
verified returning HTTP 200 `image/jpeg`. But it is an undocumented, small `s=10` cache token, so
it may rotate or expire. Hosted images on Cloudflare R2, imgur or this repo are more reliable.

There is also a test bench on the page for checking which forms still work: paste a Drive URL
into it, or use one of the bench presets. It is a developer tool, so it is **hidden by default** and
only appears with `?bench=1` (or when you open `index.html` straight off disk). Customers never see
it.

## Ordering: cart, email, manual QR

1. Customers add items and quantities in the cart. Prices are stored as integer paise.
2. They enter an email address and send the order to the cafe through EmailJS.
3. The page shows the order ID and tells the customer to check their email.
4. The cafe replies to the order email from its own inbox with a UPI QR generated in its UPI app
   for the exact total. The website never generates or stores a payment QR or UPI ID.
5. After paying from that email's QR, the customer returns to the same browser and presses
   **I've paid**. EmailJS sends a payment-claim notice to the cafe and, optionally, a receipt to
   the customer.
6. The cart clears only after the cafe's payment-claim email succeeds. A pending order is saved in
   that browser's `localStorage` and restored after refresh so the customer can return later.

### Try it without credentials

Open `index.html?demo=1`. The flow runs without sending email. The would-be order, payment-claim,
and optional receipt payloads are written to the browser console. Demo mode does not generate a
payment QR; the real cafe creates and emails that separately.

With placeholders in `site-config.js`, ordering refuses to send. Both the order and payment-claim
EmailJS templates are required before orders are enabled. The customer sees a short message; the
console names any missing configuration keys for the person maintaining the site.

### Enabling it for real

Fill in `window.CAFE_ORDER.emailjs` in `site-config.js`:

```js
emailjs: {
  serviceId:         'service_XXXXXXX',
  orderTemplateId:   'template_XXXXXXX',
  paymentTemplateId: 'template_XXXXXXX',
  receiptTemplateId: '',              // optional
  publicKey:         'PUBLIC_KEY_XXXXXXX'
}
```

The site does not need the cafe's UPI ID or payment-app credentials. Create the QR in the cafe's
UPI app and attach it when replying to each order email.

### EmailJS templates

Set the recipient in each template's **To** field. Never use customer-supplied data as the order
or payment-claim recipient.

| Template | To | Cc | Required |
|----------|----|----|----------|
| New order | Cafe address, typed into the template | — | yes |
| Payment claimed | Cafe address, typed into the template | — | yes |
| Customer receipt | `{{to_email}}` | Cafe address | no |

For **New order**, set Subject to `{{subject}}` and Reply-To to `{{reply_to}}`. Suggested body:

```
Order {{order_id}} — {{order_total_display}}
Customer: {{customer_email}}
Placed: {{placed_at}}

{{order_lines}}

Total: {{order_total_display}} ({{order_count}} items)
Reply to this email with the cafe's UPI QR for the total above.
```

For **Payment claimed**, set Subject to `{{subject}}`, keep **To** fixed to the cafe, and include
`{{order_id}}`, `{{customer_email}}`, `{{order_total_display}}`, `{{order_lines}}`, and `{{claimed_at}}`.
The payment claim is only the customer's statement; the cafe must verify the payment in its UPI
app before preparing the order.

For the optional **Customer receipt**, set **To** to `{{to_email}}`, **Cc** to the cafe, and include
the order ID and total. The customer copy is sent after the owner alert succeeds; a receipt failure
does not lose the order.

The order email has no `to_email` field, so it cannot be redirected to the customer by changing the
template's To setting. Add the site domain under **EmailJS → Account → Security → Allowed Origins**.

### What ordering does not do

- **It does not verify payment.** "I've paid" is the customer's claim. Check the cafe's UPI app
  and confirm the amount before making the order.
- **No login or server-side order store.** Anyone with the public link can submit an order. Pending
  state is local to the same browser and device; it is not shared across devices.
- **The cart is cleared after the payment-claim email succeeds.** If that send fails, the pending
  order stays available for retry.
- **EmailJS free tier is about 200 emails a month.** Each completed order uses at least two emails;
  an enabled customer receipt uses a third.
- **Client-side totals are not tamper-proof.** Someone can edit browser state. The cafe should
  compare the amount in its UPI app with the order email before preparing anything.

### Guard rails

EmailJS keys in browser JavaScript are public by design; what protects the account is the
dashboard settings plus these client-side limits:

- a hidden **honeypot** field, so naive bots see a success and send nothing. It is clipped out of
  existence with `clip-path`, not parked off-screen, so it cannot show up in a screenshot
- caps of **20 per item** and **30 different items**, which also bounds email size
- the **cart is never cleared on failure** — it is only emptied once the cafe's payment alert has
  actually gone out, so a failed send is always retryable

These browser-side checks can be bypassed by a determined sender. Keep the EmailJS origin
allowlist and account limits enabled, monitor usage, and treat those controls as abuse reduction,
not server-side authentication. A stricter public-ordering threat model requires a trusted backend,
which this project explicitly avoids.

## Deployment

`pages.yml` checks out the repo, optionally rewrites the `window.MENU_CSV_URL` line in
`site-config.js` from the `MENU_CSV_URL` repository variable, then publishes.

It replaces **only that one line**, on purpose. An earlier version rewrote the whole file, which
silently deleted the currency and the entire ordering config on every deploy.

If the `MENU_CSV_URL` variable is not set, the URL committed in `site-config.js` is used as-is, so
the site still deploys correctly. If the line is missing entirely the deploy fails loudly rather
than publishing a broken config.

## Running the checks

```
node smoke-test.js
node order-test.js
```

- `smoke-test.js` — 83 checks on file-ID extraction, URL candidates, card rendering, the tally,
  the parsers, the fetch failure paths, and that the developer test bench stays hidden unless
  `?bench=1` is set.
- `order-test.js` — money and email validation, cart guard rails, legacy `localStorage` loading and
  pending-order recovery, sheet changes under a live cart, the order → manual QR email → payment
  claim path, failures and retries, missing configuration, the honeypot, keyboard focus, and the
  requirement that the app does not generate a payment QR.

Both run the real files in a `vm` sandbox against a stub DOM, fake `localStorage` and fake EmailJS,
so no browser and no network are needed.

## Owner editor

`owner-editor/` is a private Apps Script web app the owner opens on their phone to edit the sheet
and save straight back to Drive. Add `?demo=1` to `owner-editor/Index.html` to try it against
in-memory rows. See [`owner-editor/README.md`](owner-editor/README.md).

Note that this repository is public, so the Apps Script server code and the sheet's column
structure are readable by anyone. Keeping the editor source private would need a separate private
repository.
