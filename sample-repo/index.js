/**
 * Sample Repository - Main Entry Point
 * This is a sample codebase for testing CodeAtlas
 */

import { processUser, validateUser } from './user.js';
import { calculateTotal, formatPrice } from './utils.js';

function main() {
  console.log('Application started');
  
  const user = processUser({ name: 'John', age: 30 });
  const isValid = validateUser(user);
  
  if (isValid) {
    const total = calculateTotal([10, 20, 30]);
    const formatted = formatPrice(total);
    console.log(`Total: ${formatted}`);
  }
}

function initializeApp() {
  main();
}

export { main, initializeApp };
