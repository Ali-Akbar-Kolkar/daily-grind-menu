(function (root) {
  'use strict';

  function configuredUrl() {
    var config = root && root.CAFE_ORDER;
    var url = String((config && config.appsScriptUrl) || '').trim();
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url) &&
      !/PASTE|PLACEHOLDER/i.test(url)
      ? url
      : '';
  }

  async function submit(payload) {
    var url = configuredUrl();
    if (!url) throw new Error('Apps Script Web App URL is not configured.');
    if (!root || typeof root.fetch !== 'function') throw new Error('Fetch is unavailable.');

    await root.fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    return { sent: true, orderId: payload.orderId };
  }

  if (root) root.CafeOrderBackend = { submit: submit, configuredUrl: configuredUrl };
}(typeof window !== 'undefined' ? window : null));
