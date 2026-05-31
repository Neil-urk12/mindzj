import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('vite.config.ts', () => {
  const configPath = resolve(__dirname, '../../vite.config.ts');
  const configContent = readFileSync(configPath, 'utf-8');

  it('should not contain vestigial Electron references', () => {
    expect(configContent).not.toContain('dist-electron');
  });

  it('should not reference electron as a standalone term', () => {
    const electronRegex = /\belectron\b/i;
    expect(electronRegex.test(configContent)).toBe(false);
  });
});
