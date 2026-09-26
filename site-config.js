/* Site configuration. This is the only file you need to edit to go live. */

// Published Google Sheet CSV. Leave blank to use the bundled menu-images.csv sample.
window.MENU_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vToUFJhDlT8H5SQG8CqSxfFzhYQ_KNmx9dL1SAIcOXNZiSI4I7CyD7zgjYOlbPt3ZtWWQEYjlglybPN/pub?gid=810010135&single=true&output=csv';

// Currency for the menu card prices. Must match CAFE_ORDER.currency below.
window.MENU_CURRENCY = 'INR';

// ---------------------------------------------------------------------------
// Ordering. Every value below is a PLACEHOLDER until you fill it in.
// Until the EmailJS ids are real, the cart works but "Send order" refuses to
// send and says so. Add ?demo=1 to the URL to walk the whole flow locally
// without sending anything. The cafe creates and emails payment QR codes
// manually; this site does not store a UPI ID or generate a payment QR.
// ---------------------------------------------------------------------------
window.CAFE_ORDER = {
  emailjs: {
    // emailjs.com -> Account -> API Keys  /  Email Services -> Service ID
    serviceId: 'service_XXXXXXX',
    // Email Templates -> your "New order" template id
    orderTemplateId: 'template_XXXXXXX',
    // Email Templates -> your "Payment claimed" owner-alert template id
    paymentTemplateId: 'template_XXXXXXX',
    // Account -> Public Key
    publicKey: 'PUBLIC_KEY_XXXXXXX',
    // Optional. Email Templates -> a receipt template whose To field is
    // {{to_email}}, with the cafe on Cc. Leave '' to skip the customer copy.
    receiptTemplateId: ''
  },

  currency: 'INR',
  locale: 'en-IN',

  // Guard rails
  maxQtyPerLine: 20,
  maxLines: 30,

  // Set false to skip the receipt copy to the customer
  copyToCustomer: true,

  // Force demo mode regardless of credentials
  demoMode: false
};
