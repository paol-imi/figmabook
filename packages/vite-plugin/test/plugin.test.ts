import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatSourceLoc, holotype } from '../src';

describe('@holotype/vite-plugin', () => {
  it('formats root-relative POSIX source locations', () => {
    const root = join('/', 'repo');
    expect(formatSourceLoc(root, join(root, 'src', 'components', 'Button', 'Button.tsx'), 42, 7)).toBe(
      'src/components/Button/Button.tsx:42:7',
    );
    expect(formatSourceLoc(root, 'src/App.tsx', 1, 1)).toBe('src/App.tsx:1:1');
  });

  it('only runs on the dev server, before other transforms', () => {
    expect(holotype()).toMatchObject({ name: 'holotype:jsx-loc', apply: 'serve', enforce: 'pre' });
  });
});
