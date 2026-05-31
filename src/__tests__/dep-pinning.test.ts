import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('dependency pinning', () => {
  const pkgPath = resolve(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  it('all production dependencies should use exact versions (no ^ or ~)', () => {
    const deps: Record<string, string> = pkg.dependencies ?? {};
    const unpinned: string[] = [];

    for (const [name, version] of Object.entries(deps)) {
      if (version.startsWith('^') || version.startsWith('~')) {
        unpinned.push(`${name}: ${version}`);
      }
    }

    expect(unpinned).toEqual([]);
  });
});
