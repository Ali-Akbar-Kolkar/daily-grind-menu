(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.MenuImages = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const LHS_BASE = 'https://lh3.googleusercontent.com/d/';
  const LHS_WEB = 'https://lh3.google.com/u/0/d/';
  const DRIVE_BASE = 'https://drive.google.com/';
  const BARE_ID = /^[A-Za-z0-9_-]{20,}$/;
  const DRIVE_HOST = /(^|\.)google\.com$|(^|\.)googleusercontent\.com$/i;
  const ID_PATTERNS = [
    /\/file\/d\/([A-Za-z0-9_-]{10,})/,
    /\/d\/([A-Za-z0-9_-]{10,})/,
    /[?&]id=([A-Za-z0-9_-]{10,})/
  ];

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function hostFromUrl(value) {
    const match = value.match(/^https?:\/\/([^/?#]+)/i);
    return match ? match[1].toLowerCase() : '';
  }

  function isDriveHost(host) {
    return DRIVE_HOST.test(host);
  }

  function extractFileId(value) {
    const raw = text(value);
    if (!raw) return null;
    if (BARE_ID.test(raw)) return raw;
    if (/\/folders\//i.test(raw)) return null;
    for (let i = 0; i < ID_PATTERNS.length; i += 1) {
      const match = raw.match(ID_PATTERNS[i]);
      if (match) return match[1];
    }
    return null;
  }

  function classify(value) {
    const raw = text(value);
    if (!raw) return { kind: 'empty', value: '' };
    if (/\/folders\//i.test(raw)) return { kind: 'folder', value: raw };
    if (/^https?:\/\//i.test(raw)) {
      const host = hostFromUrl(raw);
      if (!host) return { kind: 'unknown', value: raw };
      if (!isDriveHost(host)) return { kind: 'direct', value: raw };
      const fileId = extractFileId(raw);
      return fileId ? { kind: 'drive', value: raw, fileId } : { kind: 'unknown', value: raw };
    }
    if (BARE_ID.test(raw)) return { kind: 'drive', value: raw, fileId: raw };
    return { kind: 'unknown', value: raw };
  }

  function candidates(value, options) {
    const opts = options || {};
    const width = Number(opts.width) || 800;
    const info = classify(value);

    if (info.kind === 'empty' || info.kind === 'unknown' || info.kind === 'folder') return [];
    if (info.kind === 'direct') return [info.value];

    const id = info.fileId;
    return [
      LHS_BASE + id + '=w' + width,
      DRIVE_BASE + 'thumbnail?id=' + id + '&sz=w' + width,
      LHS_BASE + id,
      LHS_WEB + id,
      DRIVE_BASE + 'uc?export=view&id=' + id
    ];
  }

  function embedUrl(fileId) {
    const id = extractFileId(fileId);
    return id ? DRIVE_BASE + 'file/d/' + id + '/preview' : '';
  }

  function iframeSnippet(fileId, width, height) {
    const src = embedUrl(fileId);
    if (!src) return '';
    return '<iframe src="' + src + '" width="' + (width || 640) + '" height="' + (height || 400) +
      '" style="border:0" allowfullscreen title="Embedded preview"></iframe>';
  }

  function probeImage(url, timeoutMs) {
    return new Promise((resolve) => {
      if (typeof Image !== 'function') {
        resolve(false);
        return;
      }
      const img = new Image();
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), Number(timeoutMs) || 8000);
      img.onload = () => {
        clearTimeout(timer);
        done(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  async function resolveFirst(list, probe) {
    const test = typeof probe === 'function' ? probe : probeImage;
    const attempts = [];
    for (let i = 0; i < list.length; i += 1) {
      const url = list[i];
      let ok = false;
      try {
        ok = Boolean(await test(url));
      } catch (err) {
        ok = false;
      }
      attempts.push({ url, ok });
      if (ok) return { url, index: i, attempts };
    }
    return { url: null, index: -1, attempts };
  }

  function label(value) {
    const info = classify(value);
    if (info.kind === 'empty') return 'empty cell';
    if (info.kind === 'folder') return 'Drive folder link';
    if (info.kind === 'drive') return 'Drive file ' + info.fileId;
    if (info.kind === 'direct') return 'direct image URL';
    return 'unrecognised value';
  }

  return {
    extractFileId,
    classify,
    candidates,
    embedUrl,
    iframeSnippet,
    probeImage,
    resolveFirst,
    label
  };
}));
