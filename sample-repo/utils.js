/**
 * Utility Functions
 */

export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item, 0);
}

export function formatPrice(amount) {
  return `$${amount.toFixed(2)}`;
}

export function formatString(str) {
  return str.trim().toLowerCase();
}

export function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

function helperFunction() {
  return 'helper';
}
