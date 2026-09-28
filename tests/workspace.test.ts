import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';

test('examples workspace has framework, platform, and agents apps', () => {
  expect(existsSync('framework/basic/package.json')).toBe(true);
  expect(existsSync('platform/warehouse/package.json')).toBe(true);
  expect(existsSync('platform/kube-apps/package.json')).toBe(true);
  expect(existsSync('agents/baseball/package.json')).toBe(true);
});
