# Apps Script Order Backend

This backend receives menu orders, writes them to a separate Google Sheet, emails the customer UPI payment details, and emails the cafe an order notification. The owner confirms payment only after checking the bank app. It uses Apps Script and Gmail; there is no EmailJS service, payment gateway, or QR generator.

## 1. Create the Orders sheet

Create a new Google spreadsheet and name its tab exactly `Orders`. Add these headers in row 1, in this order:

```text
OrderID | Timestamp | CustomerName | CustomerEmail | Items | Total | Status | Token
```

Keep this as a separate sheet from the published menu CSV. The backend writes private customer details and order status here.

## 2. Add the Apps Script

From the Orders spreadsheet, choose **Extensions → Apps Script**. Replace the starter code with `Code.gs` from this folder. Fill in the five values in the `CONFIG` block:

- `SHEET_ID`: the ID between `/d/` and `/edit` in the spreadsheet URL
- `OWNER_EMAIL`: the cafe owner's email address
- `UPI_ID`: the cafe's real UPI ID
- `CAFE_NAME`: the name shown in emails
- `WEB_APP_URL`: leave this placeholder until the first deployment

Do not put the Sheet ID, owner email, or UPI ID in the public GitHub Pages code.

## 3. First Web App deployment

In Apps Script, choose **Deploy → New deployment → Web app**:

- Execute as: **Me**
- Who has access: **Anyone**

Authorize the script and deploy. Copy the URL ending in `/exec`.

## 4. Set the URL and redeploy

Paste that `/exec` URL into both:

- `CONFIG.WEB_APP_URL` in Apps Script `Code.gs`
- `window.CAFE_ORDER.appsScriptUrl` in the menu site's `site-config.js`

In Apps Script, choose **Deploy → Manage deployments → Edit → New version → Deploy**. Saving the source alone does not update an existing deployment. The second deployment bakes the URL into the owner email's confirmation link.

The Pages site must then be deployed with the updated `site-config.js`. Until both URLs are configured, checkout remains disabled. The Web App URL is public by design; the other backend values stay in Apps Script.

## 5. What the customer and owner see

1. The customer submits their name, email, and cart.
2. Apps Script records the order and emails the customer the UPI ID, total, and order ID to use as the payment reference. It also emails the owner the order details.
3. The customer pays directly in a UPI app. The menu page does not create a QR or process the payment.
4. After checking the bank app, the owner opens the email link and presses **Confirm payment received** on the confirmation page.
5. Apps Script updates the Sheet and emails the customer that payment was confirmed.

Opening the email link only displays the confirmation page; the separate button prevents mail-security link previews from marking an order paid automatically.

## Browser response limitation

The browser uses a `no-cors` POST because Apps Script does not expose a configurable CORS response header and redirects content responses to a one-time `googleusercontent.com` URL. The browser cannot read the Web App's JSON result. The checkout uses a stable order ID so retrying the same request does not create another order; the customer should wait for the order email before paying. If no email arrives, they should contact the cafe and provide the order ID rather than paying from an unconfirmed request.

## Validation and limits

The backend checks the order ID, customer details, item count, per-item quantity, unit prices, and that the submitted total matches the line items. It also rejects a second new order from the same email for 15 seconds; retries with the same order ID remain idempotent. The menu and prices still originate in the customer's browser, so the owner must compare the total with the bank transaction. The endpoint is public and is not a substitute for a full abuse-prevention service; Apps Script and Gmail quotas also apply.

Run the local checks from the `poc` folder:

```text
node smoke-test.js
node order-test.js
```

These tests do not send email or contact a deployed Apps Script project. Place a small test order after setup and verify the Orders row and both emails before using the flow with customers.
