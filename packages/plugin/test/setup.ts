import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Testing Library's auto-cleanup needs test globals, which this repo keeps off.
afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/preact');
  cleanup();
});
