/**
 * The Daily Grind order and manual UPI confirmation backend.
 * Copy this file into the Apps Script project bound to your Orders sheet.
 */

const CONFIG = {
  SHEET_ID: 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE',
  SHEET_NAME: 'Orders',
  OWNER_EMAIL: 'PASTE_YOUR_EMAIL_HERE',
  UPI_ID: 'PASTE_YOUR_UPI_ID_HERE',
  CAFE_NAME: 'The Daily Grind',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyo3eUSPxpfAof8c_dOKlZST3I2LK8wI9CwVA59zsZIBppQdjca_ZMuwV8RC43zBKV68w/exec'
};
const DEVELOPER_PORTFOLIO_URL = 'https://ali-akbar-k.github.io/PORTFOLIO/';
const DEVELOPER_LOGO_URL = 'https://ali-akbar-k.github.io/PORTFOLIO/images/Alifivacon.ico.png';

const HEADERS = ['OrderID', 'Timestamp', 'CustomerName', 'CustomerEmail', 'Items', 'Total', 'Status', 'Token'];
const ORDER_ID_PATTERN = /^ORD-[A-Z0-9-]{6,40}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ITEMS = 30;
const MAX_QTY = 20;
const MAX_TOTAL_PAISE = 100000000;

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    if (params.action === 'confirmPaid') {
      return confirmPaid_(params.orderId, params.token);
    }

    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (String(data.website || '').trim()) {
      return jsonResponse_({ ok: true, orderId: String(data.orderId || '') });
    }

    assertConfiguration_();
    const order = validateOrder_(data);
    return recordOrder_(order);
  } catch (error) {
    console.error(error);
    return jsonResponse_({ error: safeError_(error) });
  }
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'pay') return customerPaymentPage_(params.orderId);

  const orderId = String(params.orderId || '');
  const token = String(params.token || '');
  if (!ORDER_ID_PATTERN.test(orderId) || !token) return htmlResponse_('Invalid order confirmation link.');

  assertConfiguration_();
  const sheet = getOrdersSheet_();
  const rowIndex = findOrderRow_(sheet, orderId);
  if (rowIndex < 0) return htmlResponse_('Order not found.');

  const row = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
  if (String(row[7]) !== token) return htmlResponse_('Invalid order confirmation link.');
  if (row[6] === 'Paid — Preparing') return gmailReturnResponse_('This order is already marked as paid.');

  const safeId = escapeHtml_(orderId);
  const form = '<main><h1>Confirm payment</h1><p>Only continue after verifying this payment in your bank app.</p>' +
    '<p>Order <strong>' + safeId + '</strong></p>' +
    '<form method="post" action="' + escapeHtml_(CONFIG.WEB_APP_URL) + '" target="_top">' +
    '<input type="hidden" name="action" value="confirmPaid">' +
    '<input type="hidden" name="orderId" value="' + safeId + '">' +
    '<input type="hidden" name="token" value="' + escapeHtml_(token) + '">' +
    '<button type="submit">Confirm payment received</button></form></main>';
  return htmlResponse_(form);
}

function validateOrder_(data) {
  const orderId = String(data.orderId || '').trim();
  const customerName = cleanText_(data.customerName, 100);
  const customerEmail = String(data.customerEmail || '').trim().toLowerCase();
  if (!ORDER_ID_PATTERN.test(orderId)) throw new Error('Invalid order reference. Please try again.');
  if (!customerName) throw new Error('Enter your name before sending the order.');
  if (customerName.length > 100) throw new Error('Customer name is too long.');
  if (!EMAIL_PATTERN.test(customerEmail) || customerEmail.length > 254) throw new Error('Enter a valid email address.');
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > MAX_ITEMS) {
    throw new Error('The order has an invalid number of items.');
  }

  let totalPaise = 0;
  const items = data.items.map(function (item) {
    const name = cleanText_(item && item.name, 120);
    const qty = Number(item && item.qty);
    const pricePaise = Number(item && item.pricePaise);
    if (!name || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY ||
        !Number.isInteger(pricePaise) || pricePaise < 0) {
      throw new Error('An item in the order is invalid.');
    }
    totalPaise += qty * pricePaise;
    return { name: name, qty: qty, pricePaise: pricePaise };
  });

  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1 || totalPaise > MAX_TOTAL_PAISE ||
      Number(data.totalPaise) !== totalPaise) {
    throw new Error('The order total could not be verified. Please refresh the menu and try again.');
  }

  return {
    orderId: orderId,
    customerName: customerName,
    customerEmail: customerEmail,
    items: items,
    itemsText: items.map(function (item) { return item.qty + ' x ' + item.name; }).join(', '),
    totalPaise: totalPaise,
    website: String(data.website || '')
  };
}

function recordOrder_(order) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let sheet;
  let rowIndex;
  let token;
  try {
    sheet = getOrdersSheet_();
    rowIndex = findOrderRow_(sheet, order.orderId);
    if (rowIndex >= 0) {
      const saved = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
        if (String(saved[2]) !== sheetText_(order.customerName) ||
          String(saved[3]) !== sheetText_(order.customerEmail) ||
          Number(saved[5]) !== amountRupees_(order.totalPaise) ||
          String(saved[4]) !== sheetText_(order.itemsText)) {
        throw new Error('This order reference is already in use. Refresh the menu and try again.');
      }
      token = String(saved[7]);
      if (saved[6] !== 'Email Failed') {
        return jsonResponse_({ ok: true, orderId: order.orderId, status: saved[6] });
      }
      sheet.getRange(rowIndex, 7).setValue('Processing');
    } else {
      const cache = CacheService.getScriptCache();
      const cooldownKey = rateLimitKey_(order.customerEmail);
      const recentOrderId = cache.get(cooldownKey);
      if (recentOrderId && recentOrderId !== order.orderId) {
        throw new Error('Please wait a few seconds before placing another order.');
      }

      token = Utilities.getUuid();
      sheet.appendRow([
        order.orderId,
        new Date(),
        sheetText_(order.customerName),
        sheetText_(order.customerEmail),
        sheetText_(order.itemsText),
        amountRupees_(order.totalPaise),
        'Processing',
        token
      ]);
      rowIndex = sheet.getLastRow();
      cache.put(cooldownKey, order.orderId, 15);
    }
  } finally {
    lock.releaseLock();
  }

  try {
    sendCustomerOrderEmail_(order);
    sendOwnerNotifyEmail_(order, token);
    sheet.getRange(rowIndex, 7).setValue('Pending Payment');
    return jsonResponse_({ ok: true, orderId: order.orderId, status: 'Pending Payment' });
  } catch (error) {
    sheet.getRange(rowIndex, 7).setValue('Email Failed');
    console.error('Order email failed for ' + order.orderId + ': ' + error);
    return jsonResponse_({ error: 'The order was saved, but an email could not be sent. Please contact the cafe and provide order ' + order.orderId + '.' });
  }
}

function confirmPaid_(orderIdValue, tokenValue) {
  const orderId = String(orderIdValue || '');
  const token = String(tokenValue || '');
  if (!ORDER_ID_PATTERN.test(orderId) || !token) return htmlResponse_('Invalid order confirmation link.');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let sheet;
  let rowIndex;
  let customerEmail;
  let customerName;
  try {
    sheet = getOrdersSheet_();
    rowIndex = findOrderRow_(sheet, orderId);
    if (rowIndex < 0) return htmlResponse_('Order not found.');

    const row = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
    if (String(row[7]) !== token) return htmlResponse_('Invalid order confirmation link.');
    if (row[6] === 'Paid — Preparing') return gmailReturnResponse_('This order is already marked as paid.');
    if (row[6] === 'Confirming Payment') return htmlResponse_('Payment confirmation is already in progress.');
    if (row[6] !== 'Pending Payment' && row[6] !== 'Payment Email Failed') {
      return htmlResponse_('This order is not ready to be marked as paid.');
    }

    customerEmail = String(row[3]);
    customerName = String(row[2]);
    sheet.getRange(rowIndex, 7).setValue('Confirming Payment');
  } finally {
    lock.releaseLock();
  }

  try {
    sendPaymentConfirmedEmail_(customerEmail, customerName, orderId);
    sheet.getRange(rowIndex, 7).setValue('Paid — Preparing');
    return gmailReturnResponse_('Payment confirmed for order ' + escapeHtml_(orderId) + '. A confirmation email was sent to the customer.');
  } catch (error) {
    console.error('Payment confirmation email failed for ' + orderId + ': ' + error);
    sheet.getRange(rowIndex, 7).setValue('Payment Email Failed');
    return htmlResponse_('Payment was verified, but the confirmation email failed. Reopen this link to retry the email.');
  }
}

function sendCustomerOrderEmail_(order) {
  const subject = CONFIG.CAFE_NAME + ' — Order ' + order.orderId + ' received';
  const paymentUrl = upiPaymentUrl_(order);
  const paymentPageUrl = paymentPageUrl_(order.orderId);
  let paymentQr = null;
  let qrMarkup = '';
  let qrFallback = '';
  try {
    paymentQr = paymentQrImage_(paymentUrl);
    qrMarkup = '<p><strong>Scan this QR code with your UPI app:</strong></p>' +
      '<p><img src="cid:paymentQr" alt="UPI payment QR code" width="240" height="240" ' +
      'style="display:block;width:240px;height:240px;max-width:100%;height:auto"></p>';
  } catch (error) {
    console.error('Payment QR generation failed for ' + order.orderId + ': ' + error);
    qrFallback = 'The QR image is loaded directly in this email. If it is not visible, use the UPI link below.\n';
    const qrImageUrl = generateUpiQrUrl_(order);
    qrMarkup = '<p><strong>Scan this UPI QR code:</strong></p>' +
      '<p><img src="' + escapeHtml_(qrImageUrl) + '" alt="UPI payment QR code" width="240" height="240" ' +
      'style="display:block;width:240px;height:240px;max-width:100%;height:auto"></p>';
  }
  let developerLogo = null;
  try {
    developerLogo = developerLogoImage_();
  } catch (error) {
    console.error('Developer logo fetch failed for order ' + order.orderId + ': ' + error);
  }
  const body = 'Hi ' + order.customerName + ',\n\n' +
    'Thanks for your order from ' + CONFIG.CAFE_NAME + '!\n\n' +
    'Order ID: ' + order.orderId + '\n' +
    'Items: ' + order.itemsText + '\n' +
    'Total: ' + formatRupees_(order.totalPaise) + '\n\n' +
    qrFallback +
    'Scan the attached QR code with your UPI app, or use the direct UPI link below.\n\n' +
    'Pay with UPI: ' + paymentPageUrl + '\n' +
    'Standard UPI link: ' + paymentUrl + '\n' +
    'If the link does not open, pay to UPI ID: ' + CONFIG.UPI_ID + '\n' +
    'Use ' + order.orderId + ' as the payment note/reference.\n\n' +
    'We will email you after the cafe verifies the payment.\n\n— ' + CONFIG.CAFE_NAME +
    developerEmailFooterText_();
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#33201a;max-width:560px">' +
    '<p>Hi ' + escapeHtml_(order.customerName) + ',</p>' +
    '<p>Thanks for your order from ' + escapeHtml_(CONFIG.CAFE_NAME) + '.</p>' +
    '<p><strong>Order:</strong> ' + escapeHtml_(order.orderId) + '<br>' +
    '<strong>Items:</strong> ' + escapeHtml_(order.itemsText) + '<br>' +
    '<strong>Total:</strong> ' + escapeHtml_(formatRupees_(order.totalPaise)) + '</p>' +
    qrMarkup +
    '<p><a href="' + escapeHtml_(paymentPageUrl) + '" style="display:inline-block;padding:12px 18px;background:#176b45;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Pay with UPI</a></p>' +
    '<p>If the button does not open a UPI app, try the <a href="' + escapeHtml_(paymentUrl) + '">standard UPI link</a>, or pay to <strong>' + escapeHtml_(CONFIG.UPI_ID) + '</strong> and use <strong>' + escapeHtml_(order.orderId) + '</strong> as the payment reference.</p>' +
    '<p>The cafe will email you after verifying the payment.</p>' +
    '<p>— ' + escapeHtml_(CONFIG.CAFE_NAME) + '</p>' +
    developerEmailFooterHtml_(Boolean(developerLogo)) + '</div>';
  const message = {
    to: order.customerEmail,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: CONFIG.CAFE_NAME
  };
  if (paymentQr) message.inlineImages = { paymentQr: paymentQr };
  if (developerLogo) {
    message.inlineImages = message.inlineImages || {};
    message.inlineImages.developerLogo = developerLogo;
  }
  MailApp.sendEmail(message);
}

function paymentQrImage_(paymentUrl) {
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=480x480&format=png&data=' +
    encodeURIComponent(paymentUrl);
  const response = UrlFetchApp.fetch(qrUrl, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('QR image service returned HTTP ' + response.getResponseCode() + '.');
  }
  const image = response.getBlob();
  if (String(image.getContentType() || '').indexOf('image/') !== 0) {
    throw new Error('QR image service did not return an image.');
  }
  return image.setName('payment-qr.png');
}

function authorizeQrImageService() {
  const testPaymentUrl = upiPaymentUrl_({
    orderId: 'ORD-QRTEST123',
    totalPaise: 100
  });
  const image = paymentQrImage_(testPaymentUrl);
  console.log('QR image service authorized; generated ' + image.getContentType() + '.');
}

function upiPaymentUrl_(order) {
  const params = [
    'pa=' + encodeURIComponent(CONFIG.UPI_ID),
    'pn=' + encodeURIComponent(CONFIG.CAFE_NAME),
    'am=' + (order.totalPaise / 100).toFixed(2),
    'cu=INR',
    'tn=' + encodeURIComponent(order.orderId),
    'tr=' + encodeURIComponent(order.orderId)
  ];
  return 'upi://pay?' + params.join('&');
}

function paymentPageUrl_(orderId) {
  return CONFIG.WEB_APP_URL + '?action=pay&orderId=' + encodeURIComponent(orderId);
}

function generateUpiQrUrl_(order) {
  const paymentUrl = upiPaymentUrl_(order);
  return 'https://api.qrserver.com/v1/create-qr-code/?size=480x480&format=png&data=' +
    encodeURIComponent(paymentUrl);
}

function customerPaymentPage_(orderIdValue) {
  const orderId = String(orderIdValue || '');
  if (!ORDER_ID_PATTERN.test(orderId)) return htmlResponse_('Invalid payment link.');

  assertConfiguration_();
  const sheet = getOrdersSheet_();
  const rowIndex = findOrderRow_(sheet, orderId);
  if (rowIndex < 0) return htmlResponse_('Order not found.');

  const row = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
  if (row[6] === 'Paid — Preparing') return htmlResponse_('This order is already marked as paid.');
  if (row[6] !== 'Pending Payment' && row[6] !== 'Processing' && row[6] !== 'Email Failed') {
    return htmlResponse_('This order is not ready for payment. Please contact the cafe.');
  }

  const totalPaise = Math.round(Number(row[5]) * 100);
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) {
    return htmlResponse_('The order total is invalid. Please contact the cafe.');
  }

  const paymentUrl = upiPaymentUrl_({ orderId: orderId, totalPaise: totalPaise });
  return HtmlService.createHtmlOutput(paymentPageHtml_(orderId, totalPaise, paymentUrl));
}

function paymentPageHtml_(orderId, totalPaise, paymentUrl) {
  const qrImageUrl = generateUpiQrUrl_({ orderId: orderId, totalPaise: totalPaise });
  return '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Pay with UPI</title>' +
    '<body style="font:16px system-ui,sans-serif;max-width:34rem;margin:8vh auto;padding:1.5rem;color:#26352c">' +
    '<main><h1>Complete your payment</h1>' +
    '<p>Order <strong>' + escapeHtml_(orderId) + '</strong></p>' +
    '<p>Amount: <strong>' + escapeHtml_(formatRupees_(totalPaise)) + '</strong></p>' +
    '<p>UPI ID: <strong>' + escapeHtml_(CONFIG.UPI_ID) + '</strong></p>' +
    '<p>Reference: <strong>' + escapeHtml_(orderId) + '</strong></p>' +
    '<p><img src="' + escapeHtml_(qrImageUrl) + '" alt="UPI payment QR code" width="240" height="240" ' +
    'style="display:block;width:240px;height:240px;max-width:100%;height:auto;margin:1rem auto"></p>' +
    '<p><a target="_top" href="' + escapeHtml_(paymentUrl) + '" style="display:inline-block;padding:14px 20px;background:#176b45;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Open UPI app</a></p>' +
    '<p>Review the payee, amount, and order reference in your UPI app before authorizing. Payment is not confirmed automatically.</p>' +
    '<p><a target="_top" href="' + escapeHtml_(paymentUrl) + '">Try the UPI link again</a></p>' +
    '</main></body></html>';
}

function sendOwnerNotifyEmail_(order, token) {
  const markPaidUrl = CONFIG.WEB_APP_URL + '?orderId=' + encodeURIComponent(order.orderId) +
    '&token=' + encodeURIComponent(token);
  const subject = 'New order ' + order.orderId + ' — ' + order.customerName;
  const body = 'New order received. Payment is pending.\n\n' +
    'Order ID: ' + order.orderId + '\n' +
    'Customer: ' + order.customerName + ' (' + order.customerEmail + ')\n' +
    'Items: ' + order.itemsText + '\n' +
    'Total: ' + formatRupees_(order.totalPaise) + '\n\n' +
    'After you verify payment in your banking app, open this link and confirm on the next page:\n' + markPaidUrl +
    developerEmailFooterText_();
  let developerLogo = null;
  try {
    developerLogo = developerLogoImage_();
  } catch (error) {
    console.error('Developer logo fetch failed for owner notification ' + order.orderId + ': ' + error);
  }
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#33201a;max-width:560px;line-height:1.5">' +
    '<h2 style="color:#176b45">New order received</h2>' +
    '<p>Payment is pending. Verify the payment in your banking app before confirming.</p>' +
    '<p><strong>Order:</strong> ' + escapeHtml_(order.orderId) + '<br>' +
    '<strong>Customer:</strong> ' + escapeHtml_(order.customerName) + ' (' +
    escapeHtml_(order.customerEmail) + ')<br>' +
    '<strong>Items:</strong> ' + escapeHtml_(order.itemsText) + '<br>' +
    '<strong>Total:</strong> ' + escapeHtml_(formatRupees_(order.totalPaise)) + '</p>' +
    '<p><a href="' + escapeHtml_(markPaidUrl) + '" ' +
    'style="display:inline-block;padding:13px 20px;background:#176b45;color:#fff;' +
    'text-decoration:none;border-radius:6px;font-weight:bold">Review and confirm payment</a></p>' +
    '<p>This opens a confirmation page. Press its confirmation button only after verifying the payment.</p>' +
    '<p>If the button does not work, copy this link into your browser:<br>' +
    '<a href="' + escapeHtml_(markPaidUrl) + '">' + escapeHtml_(markPaidUrl) + '</a></p>' +
    '<p>— ' + escapeHtml_(CONFIG.CAFE_NAME) + '</p>' +
    developerEmailFooterHtml_(Boolean(developerLogo)) + '</div>';
  const message = {
    to: CONFIG.OWNER_EMAIL,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: CONFIG.CAFE_NAME
  };
  if (developerLogo) message.inlineImages = { developerLogo: developerLogo };
  MailApp.sendEmail(message);
}

function sendPaymentConfirmedEmail_(email, name, orderId) {
  const subject = CONFIG.CAFE_NAME + ' — Payment confirmed for ' + orderId;
  const body = 'Hi ' + name + ',\n\n' +
    'The cafe has confirmed payment for order ' + orderId + '. Your order is being prepared.\n\n— ' + CONFIG.CAFE_NAME +
    developerEmailFooterText_();
  let developerLogo = null;
  try {
    developerLogo = developerLogoImage_();
  } catch (error) {
    console.error('Developer logo fetch failed for payment confirmation ' + orderId + ': ' + error);
  }
  const htmlBody = '<div style="font-family:Arial,sans-serif;color:#33201a;max-width:560px">' +
    '<p>Hi ' + escapeHtml_(name) + ',</p>' +
    '<p>The cafe has confirmed payment for order <strong>' + escapeHtml_(orderId) +
    '</strong>. Your order is being prepared.</p>' +
    '<p>— ' + escapeHtml_(CONFIG.CAFE_NAME) + '</p>' +
    developerEmailFooterHtml_(Boolean(developerLogo)) + '</div>';
  const message = {
    to: email,
    subject: subject,
    body: body,
    htmlBody: htmlBody,
    name: CONFIG.CAFE_NAME
  };
  if (developerLogo) message.inlineImages = { developerLogo: developerLogo };
  MailApp.sendEmail(message);
}

function getOrdersSheet_() {
  assertConfiguration_();
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('The Orders tab was not found. Check the sheet tab name.');
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function assertConfiguration_() {
  const values = [CONFIG.SHEET_ID, CONFIG.OWNER_EMAIL, CONFIG.UPI_ID, CONFIG.CAFE_NAME, CONFIG.WEB_APP_URL];
  if (values.some(function (value) { return !String(value || '').trim() || /PASTE|PLACEHOLDER/i.test(value); })) {
    throw new Error('Complete the five CONFIG values in Code.gs before accepting orders.');
  }
  if (!EMAIL_PATTERN.test(CONFIG.OWNER_EMAIL) || CONFIG.UPI_ID.indexOf('@') < 1 ||
      !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(CONFIG.WEB_APP_URL)) {
    throw new Error('Check OWNER_EMAIL, UPI_ID, and WEB_APP_URL in Code.gs.');
  }
}

function findOrderRow_(sheet, orderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const found = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(orderId).matchEntireCell(true).findNext();
  return found ? found.getRow() : -1;
}

function formatRupees_(totalPaise) {
  return 'INR ' + (totalPaise / 100).toFixed(2);
}

function amountRupees_(totalPaise) {
  return Number((totalPaise / 100).toFixed(2));
}

function rateLimitKey_(email) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(email).toLowerCase());
  return 'order-' + Utilities.base64EncodeWebSafe(digest);
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function sheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+@\-]/.test(text) ? "'" + text : text;
}

function escapeHtml_(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function developerLogoImage_() {
  const response = UrlFetchApp.fetch(DEVELOPER_LOGO_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) {
    throw new Error('Logo image service returned HTTP ' + response.getResponseCode() + '.');
  }
  const image = response.getBlob();
  if (String(image.getContentType() || '').indexOf('image/') !== 0) {
    throw new Error('Portfolio logo URL did not return an image.');
  }
  return image.setName('developer-logo.png');
}

function developerEmailFooterHtml_(hasInlineLogo) {
  const logoSource = hasInlineLogo ? 'cid:developerLogo' : DEVELOPER_LOGO_URL;
  return '<hr style="border:0;border-top:1px solid #eadfd9;margin:24px 0 16px">' +
    '<div style="font:13px Arial,sans-serif;color:#66554f;text-align:center">' +
    '<a href="' + escapeHtml_(DEVELOPER_PORTFOLIO_URL) + '" target="_blank" ' +
    'style="display:inline-block;text-decoration:none">' +
    '<img src="' + escapeHtml_(logoSource) + '" width="72" height="72" ' +
    'alt="Ali-Akbar-K developer logo" style="display:block;width:56px;height:56px;' +
    'object-fit:contain;border:0;margin:0 auto 8px"></a>' +
    '<div>Designed &amp; developed by <a href="' + escapeHtml_(DEVELOPER_PORTFOLIO_URL) +
    '" target="_blank" style="color:#176b45;font-weight:bold">Ali-Akbar-K</a></div>' +
    '</div>';
}

function developerEmailFooterText_() {
  return '\n\nDesigned & developed by Ali-Akbar-K\nPortfolio: ' + DEVELOPER_PORTFOLIO_URL;
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function htmlResponse_(message) {
  return HtmlService.createHtmlOutput('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order status</title><body style="font:16px system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:1.5rem;color:#33201a">' +
    '<h1 style="font-size:1.5rem">' + message + '</h1></body></html>');
}

function gmailReturnResponse_(message) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="3;url=https://mail.google.com/mail/u/0/#sent">' +
    '<title>Payment status</title>' +
    '<body style="font:16px system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:1.5rem;color:#33201a">' +
    '<main style="text-align:center">' +
    '<h1 style="font-size:1.5rem">' + message + '</h1>' +
    '<p>Returning to Gmail in a few seconds…</p>' +
    '<p><a target="_top" href="https://mail.google.com/mail/u/0/#sent" ' +
    'style="display:inline-block;margin-top:1rem;padding:12px 20px;background:#176b45;color:#fff;' +
    'text-decoration:none;border-radius:6px;font-weight:bold">Back to Gmail</a></p>' +
    '</main></body></html>'
  );
}

function safeError_(error) {
  return error && error.message ? String(error.message).slice(0, 240) : 'The order could not be processed.';
}
