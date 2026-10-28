import { expect, it } from 'vitest';
import { isNewerVersion } from '../src/ide-update.js';

it('only offers newer semantic versions', () => {
  expect(isNewerVersion('0.2.0', 'v0.2.1')).toBe(true);
  expect(isNewerVersion('0.2.0', 'v0.3.0')).toBe(true);
  expect(isNewerVersion('0.2.0', 'v0.2.0')).toBe(false);
  expect(isNewerVersion('0.2.0', 'v0.1.9')).toBe(false);
  expect(isNewerVersion('0.2.0', 'preview')).toBe(false);
});
