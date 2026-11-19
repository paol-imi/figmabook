import { describe, expect, it } from 'vitest';
import {
  asSentence,
  chapterTitle,
  escapeHtml,
  isDelimiterRow,
  rebasePlanLinks,
  splitTableRow,
  toPlainText,
  unescapeCell,
} from '../src/markdown.ts';

describe('splitTableRow', () => {
  it('splits on unescaped pipes and trims cells', () => {
    expect(splitTableRow('| a | `b` |  c  |')).toEqual(['a', '`b`', 'c']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
  });

  it('keeps escaped pipes, also inside code spans', () => {
    expect(splitTableRow('| `a \\| b` | c \\| d |')).toEqual(['`a \\| b`', 'c \\| d']);
  });

  it('keeps empty cells', () => {
    expect(splitTableRow('| a |  | c |')).toEqual(['a', '', 'c']);
  });
});

describe('isDelimiterRow', () => {
  it('accepts alignment markers', () => {
    expect(isDelimiterRow('|---|:--:|--:|')).toBe(true);
    expect(isDelimiterRow('| Code | Severity |')).toBe(false);
  });
});

describe('toPlainText', () => {
  it('drops emphasis and link targets but keeps code spans', () => {
    expect(toPlainText('Use **Copy diagnostic**; see [03](03-storybook.md) and `**raw**`')).toBe(
      'Use Copy diagnostic; see 03 and `**raw**`',
    );
  });

  it('resolves escapes', () => {
    expect(toPlainText('`a \\| b` or c \\| d, 2 \\* 3')).toBe('`a | b` or c | d, 2 * 3');
  });
});

describe('escapeHtml / unescapeCell', () => {
  it('escapes angle brackets outside code only', () => {
    expect(escapeHtml('file <branch> `<kept>`')).toBe('file &lt;branch> `<kept>`');
  });

  it('turns cell pipes into plain pipes', () => {
    expect(unescapeCell('a \\| b')).toBe('a | b');
  });
});

describe('rebasePlanLinks', () => {
  it('points relative links at the plan folder and leaves URLs and code alone', () => {
    expect(
      rebasePlanLinks(
        '[03](03-storybook.md#a), [here](#walk), [web](https://x.test/a), [abs](/x.md), `[c](d.md)`',
        '12-quality.md',
        '../../internal/plan/',
      ),
    ).toBe(
      '[03](../../internal/plan/03-storybook.md#a), [here](../../internal/plan/12-quality.md#walk), [web](https://x.test/a), [abs](/x.md), `[c](d.md)`',
    );
  });
});

describe('chapterTitle', () => {
  it('drops the chapter number, its separator and a trailing parenthetical', () => {
    expect(chapterTitle('# 05: Capture engine\n\nText.')).toBe('Capture engine');
    expect(chapterTitle('# 09 · Figma plugin (package `plugin`)\n')).toBe('Figma plugin');
    expect(chapterTitle('# 06 — Intermediate representations (package `ir`)')).toBe('Intermediate representations');
    expect(chapterTitle('# 15 · Design change requests (Figma → AI prompt)')).toBe('Design change requests');
    expect(chapterTitle('# 11 — UX: CLI, configuration, plugin, generated artifacts')).toBe(
      'UX: CLI, configuration, plugin, generated artifacts',
    );
  });

  it('reads the first level-one heading only', () => {
    expect(chapterTitle('Intro\n\n## 1. Scope\n\n# 12 — Quality\n\n# Other')).toBe('Quality');
  });

  it('is undefined without a title', () => {
    expect(chapterTitle('# 03\n')).toBeUndefined();
    expect(chapterTitle('## Not a title\n')).toBeUndefined();
    expect(chapterTitle('')).toBeUndefined();
  });
});

describe('asSentence', () => {
  it('capitalizes and adds a full stop when missing', () => {
    expect(asSentence('the run failed')).toBe('The run failed.');
    expect(asSentence('Nothing to do')).toBe('Nothing to do.');
    expect(asSentence('`index.json` missing (exit 3)')).toBe('`index.json` missing (exit 3).');
    expect(asSentence('Done!')).toBe('Done!');
    expect(asSentence('  Already a sentence.  ')).toBe('Already a sentence.');
  });
});
