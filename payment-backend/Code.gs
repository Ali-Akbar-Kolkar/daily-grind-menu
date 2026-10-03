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
  const orderId = String(params.orderId || '');
  const token = String(params.token || '');
  if (!ORDER_ID_PATTERN.test(orderId) || !token) return htmlResponse_('Invalid order confirmation link.');

  assertConfiguration_();
  const sheet = getOrdersSheet_();
  const rowIndex = findOrderRow_(sheet, orderId);
  if (rowIndex < 0) return htmlResponse_('Order not found.');

  const row = sheet.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
  if (String(row[7]) !== token) return htmlResponse_('Invalid order confirmation link.');
  if (row[6] === 'Paid — Preparing') return htmlResponse_('This order is already marked as paid.');

  const safeId = escapeHtml_(orderId);
  const form = '<main><h1>Confirm payment</h1><p>Only continue after verifying this payment in your bank app.</p>' +
    '<p>Order <strong>' + safeId + '</strong></p>' +
    '<form method="post" action="' + escapeHtml_(CONFIG.WEB_APP_URL) + '">' +
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
    if (row[6] === 'Paid — Preparing') return htmlResponse_('This order is already marked as paid.');
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
    return htmlResponse_('Payment confirmed for order ' + escapeHtml_(orderId) + '. A confirmation email was sent to the customer.');
  } catch (error) {
    console.error('Payment confirmation email failed for ' + orderId + ': ' + error);
    sheet.getRange(rowIndex, 7).setValue('Payment Email Failed');
    return htmlResponse_('Payment was verified, but the confirmation email failed. Reopen this link to retry the email.');
  }
}

function sendCustomerOrderEmail_(order) {
  const subject = CONFIG.CAFE_NAME + ' — Order ' + order.orderId + ' received';
  const body = 'Hi ' + order.customerName + ',\n\n' +
    'Thanks for your order from ' + CONFIG.CAFE_NAME + '!\n\n' +
    'Order ID: ' + order.orderId + '\n' +
    'Items: ' + order.itemsText + '\n' +
    'Total: ' + formatRupees_(order.totalPaise) + '\n\n' +
    'To complete your order, pay by UPI to: ' + CONFIG.UPI_ID + '\n' +
    'Use ' + order.orderId + ' as the payment note/reference.\n\n' +
    'We will email you after the cafe verifies the payment.\n\n— ' + CONFIG.CAFE_NAME;
  MailApp.sendEmail({ to: order.customerEmail, subject: subject, body: body, name: CONFIG.CAFE_NAME });
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
    'After you verify payment in your banking app, open this link and confirm:\n' + markPaidUrl;
  MailApp.sendEmail({ to: CONFIG.OWNER_EMAIL, subject: subject, body: body, name: CONFIG.CAFE_NAME });
}

function sendPaymentConfirmedEmail_(email, name, orderId) {
  const subject = CONFIG.CAFE_NAME + ' — Payment confirmed for ' + orderId;
  const body = 'Hi ' + name + ',\n\n' +
    'The cafe has confirmed payment for order ' + orderId + '. Your order is being prepared.\n\n— ' + CONFIG.CAFE_NAME;
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: CONFIG.CAFE_NAME });
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

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function htmlResponse_(message) {
  return HtmlService.createHtmlOutput('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order status</title><body style="font:16px system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:1.5rem;color:#33201a">' +
    '<h1 style="font-size:1.5rem">' + message + '</h1></body></html>');
}

function safeError_(error) {
  return error && error.message ? String(error.message).slice(0, 240) : 'The order could not be processed.';
}
