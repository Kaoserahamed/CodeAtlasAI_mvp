/**
 * User Management Module
 */

import { formatString } from './utils.js';

export function processUser(userData) {
  const normalized = normalizeUserData(userData);
  return enrichUser(normalized);
}

export function validateUser(user) {
  if (!user.name || !user.age) {
    return false;
  }
  return checkAge(user.age);
}

function normalizeUserData(data) {
  return {
    name: formatString(data.name),
    age: parseInt(data.age, 10),
  };
}

function enrichUser(user) {
  return {
    ...user,
    id: generateUserId(),
    createdAt: new Date(),
  };
}

function checkAge(age) {
  return age >= 18;
}

function generateUserId() {
  return Math.random().toString(36).substr(2, 9);
}
