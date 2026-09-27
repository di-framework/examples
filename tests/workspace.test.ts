import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';

test('examples workspace root exists', () => {
  expect(existsSync('package.json')).toBe(true);
});
