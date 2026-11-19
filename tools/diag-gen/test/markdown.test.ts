import { describe, expect, it } from 'vitest';
import {
  asSentence,
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
  it('points relative links at docs/plan and leaves URLs and code alone', () => {
    expect(
      rebasePlanLinks('[03](03-storybook.md#a), [here](#walk), [web](https://x.test/a), `[c](d.md)`', '12-quality.md'),
    ).toBe('[03](../plan/03-storybook.md#a), [here](../plan/12-quality.md#walk), [web](https://x.test/a), `[c](d.md)`');
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
