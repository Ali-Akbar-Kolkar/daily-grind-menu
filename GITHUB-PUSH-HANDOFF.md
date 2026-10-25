# Daily Grind checkout update handoff

This note summarizes the checkout changes prepared locally and how to move
them to a repository where you have permission to push. It does not contain
Apps Script credentials or the ignored local `appScript` snapshot.

## What changed

Two commits are present locally on `main`, ahead of `origin/main`:

- `ca259ae` — Add on-page UPI QR and WhatsApp checkout
- `f5595c7` — Add payment page link to checkout

Together, these updates:

- Add an optional `wa.me` click-to-chat order message and build its URL with
  bounded message length and safe URL encoding.
- Add the browser-generated UPI QR/payment details, using the UPI parameters
  already used by the Apps Script email flow. The QR is generated in the
  browser; the separate email QR flow was not changed.
- Add **Pay with UPI** to the payment-pending step. It uses the same HTTPS
  payment-page route as the email:
  `https://script.google.com/macros/s/<deployment-id>/exec?action=pay&orderId=<encoded-order-id>`.
  The URL contains no amount, UPI ID, token, or signature. Apps Script looks up
  the order in the `Orders` sheet and obtains the UPI ID from its server-side
  configuration. If the row is not yet available, the existing page displays
  **Order not found**; wait and refresh or use the email link.
- Restore payment and WhatsApp links for a pending order after page reload,
  and clear them when starting a new order.
- Add checkout tests and update the README. Add
  `OWNER-REPLY-TEMPLATES.md` with three WhatsApp Business quick replies.

No order payload, `submit-order.js`, Apps Script code, or email QR logic was
changed.

The working tree was clean after the commits. `node order-test.js` passed, and
`git diff --check` passed. The ignored local `appScript` and
`PROJECT-STATUS.md` are not part of either commit.

## Why the live site has not changed

The push was rejected by GitHub with HTTP 403:

```text
Permission to Ali-Akbar-Kolkar/daily-grind-menu.git denied to Ali-Akbar-K.
```

The current Git credentials authenticate as `Ali-Akbar-K`, which does not have
write access to `Ali-Akbar-Kolkar/daily-grind-menu`. The local branch has two
commits not present on `origin/main`. GitHub Pages cannot publish them until
someone with repository write access pushes them.

The browser screenshot from `127.0.0.1:5500` showed the local version. The live
GitHub Pages site still serves the last successfully pushed version.

## If pushing the existing local commits

From Git Bash, go into the repository and check the branch:

```bash
cd ~/Desktop/poc/daily-grind-menu
git status --short --branch
```

Then authenticate with a GitHub account that has write access, or ask the
repository owner to grant `Ali-Akbar-K` **Write** permission. After that:

```bash
git push origin main
```

Changing directories or retrying the command cannot resolve a 403 by itself;
the authenticated account needs permission. Do not put a password or token in
the remote URL.

## If using a fresh clone or another workspace

The commits described above exist in the current local clone. A fresh clone
from GitHub will not contain them until they are pushed or transferred. The
handoff prompt below can be pasted into an AI coding assistant opened in the
fresh repository.

### Copy-paste implementation prompt

```text
Please update this Daily Grind static site checkout, using only the existing
plain-file patterns and no build step or new dependencies.

Before coding, inspect order.js, index.html, site-config.js, order-test.js,
style.css, README.md, payment-backend/Code.gs, and (if present) the local
configured Apps Script snapshot. Do not edit or commit any private/local
Apps Script snapshot. Confirm that the existing customer-email payment URL is
the Apps Script /exec URL with ?action=pay&orderId=<encoded ID>, that the
payment route looks up the Orders sheet row and gets amount/UPI data from
server-side storage/config, and that a missing order produces “Order not
found.” Do not put amount or UPI ID in the browser-built payment-page URL.

Implement the following:
1. Add a pure buildPaymentPageUrl(orderId, config) helper. It must create the
   exact same URL as the customer email, and return an empty string for an
   invalid order ID or unconfigured/invalid Apps Script /exec URL.
2. In #stepPay, add a visible “Pay with UPI” anchor before the QR/WhatsApp
   actions, with target="_blank" and rel="noopener noreferrer". The URL should
   be set after submit and when a pending order is restored. Clear its href
   and hide it when starting a new order.
3. Keep the existing optional WhatsApp click-to-chat button. It is
   customer-initiated only and stays hidden when whatsappNumber is empty or
   invalid. Do not change any WhatsApp API opt-in fields or the order payload.
4. Explain that the payment page gets order amount and UPI ID from the
   server-side Orders sheet/config, not URL parameters. Because submit uses
   no-cors and cannot confirm backend acceptance, tell customers that if the
   page says “Order not found,” they should wait a minute and refresh or use
   the email link. Do not say the order/payment is confirmed; email remains
   the confirmation of record.
5. Add tests using the existing vm sandbox/stub DOM for exact URL format,
   invalid ID/config, no amount/UPI/token/signature in URL, visibility after
   submit and pending-order restore, clearing on new order, and independent
   WhatsApp hidden behavior. Keep all existing tests passing.
6. Update README.md. Add OWNER-REPLY-TEMPLATES.md with a payment-request
   template using the payment-page pattern, plus “Payment received, thank
   you” and “Order is being prepared” replies.

Do not modify Apps Script, submit-order.js, the order payload, or the email
QR logic. Do not commit secrets or private snapshots. Run node order-test.js
and git diff --check, then summarize changed files and test results. Do not
push or commit unless I explicitly request it.
```

## Publishing checklist

1. Get repository write permission for the GitHub account used for pushing.
2. Push the two local commits, or apply the prompt above in the correct clone
   and commit the resulting changes.
3. Check the repository's **Actions** tab for a successful GitHub Pages
   deployment.
4. Refresh the deployed page, preferably with a hard refresh. A demo order
   will generate a payment URL but will show **Order not found** on Apps
   Script because demo orders are not submitted.
