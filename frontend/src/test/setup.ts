/**
 * Test setup shared by every frontend spec.
 *
 * Registers the jest-dom matchers so assertions can read
 * `expect(el).toBeInTheDocument()` rather than checking classes and text
 * nodes by hand.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library does not unmount between tests automatically under Vitest
// (it does under Jest), so without this a rendered tree from one test leaks
// into the next and queries match elements that should not exist.
afterEach(() => {
  cleanup();
});