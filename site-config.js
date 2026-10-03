/* Site configuration. This is the only file you need to edit to go live. */

// Published Google Sheet CSV. Leave blank to use the bundled menu-images.csv sample.
window.MENU_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vToUFJhDlT8H5SQG8CqSxfFzhYQ_KNmx9dL1SAIcOXNZiSI4I7CyD7zgjYOlbPt3ZtWWQEYjlglybPN/pub?gid=810010135&single=true&output=csv';

// Currency for the menu card prices. Must match CAFE_ORDER.currency below.
window.MENU_CURRENCY = 'INR';

// Apps Script Web App URL. Deploy payment-backend/Code.gs as a Web App first.
// Leave this placeholder until you have the deployment URL ending in /exec.
window.CAFE_ORDER = {
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbyo3eUSPxpfAof8c_dOKlZST3I2LK8wI9CwVA59zsZIBppQdjca_ZMuwV8RC43zBKV68w/exec',

  currency: 'INR',
  locale: 'en-IN',

  // Guard rails
  maxQtyPerLine: 20,
  maxLines: 30,

  // Add ?demo=1 to the URL to test the order form without submitting.
  demoMode: false
};
