import { describe, expect, it } from 'vitest';
import { createTranslator, formatMessage, type MessageArgs, MessageFormatError, t } from '../src/ui/i18n';
import en from '../src/ui/messages/en.json';

describe('formatMessage (ICU subset)', () => {
  it('substitutes arguments and leaves other text alone', () => {
    expect(formatMessage('Hello {name}, it isn’t # time', { name: 'Ada' })).toBe('Hello Ada, it isn’t # time');
  });

  it.each([
    [0, 'No warnings'],
    [1, '1 message'],
    [2, '2 messages'],
    [1200, '1,200 messages'],
  ])('selects plural forms (%i)', (count, expected) => {
    expect(formatMessage('{count, plural, =0 {No warnings} one {# message} other {# messages}}', { count })).toBe(
      expected,
    );
  });

  it('formats arguments inside plural branches', () => {
    expect(formatMessage('{n, plural, one {# variant in {s} s} other {# variants in {s} s}}', { n: 3, s: '1.5' })).toBe(
      '3 variants in 1.5 s',
    );
  });

  it.each([
    ['unbalanced braces', 'Hello {name', { name: 'x' }],
    ['a stray closing brace', 'Hello }', {}],
    ['a missing argument', 'Hello {name}', {}],
    ['a plural without other', '{n, plural, one {#}}', { n: 1 }],
    ['an unsupported type', '{n, select, a {A} other {B}}', { n: 1 }],
    ['stray plural text', '{n, plural, one {#} other {#} trailing}', { n: 1 }],
    ['a missing selector', '{n, plural, {#} other {#}}', { n: 1 }],
  ])('throws on %s', (_label, message, args: MessageArgs) => {
    expect(() => formatMessage(message, args)).toThrow(MessageFormatError);
  });
});

describe('message catalog (11 §6.13)', () => {
  const anyArgs = new Proxy({}, { get: () => 2 }) as MessageArgs;

  it.each(Object.keys(en))('%s is valid ICU', (key) => {
    expect(() => t(key as keyof typeof en, anyArgs)).not.toThrow();
  });

  it('never shows internal vocabulary to users (11 §6.12)', () => {
    for (const message of Object.values(en)) expect(message).not.toMatch(/\b(IR|Scene|nk|vk|sid)\b/);
  });

  it('falls back to English for keys a locale lacks', () => {
    const fr = createTranslator({ 'tabs.report': 'Rapport' }, 'fr');
    expect(fr('tabs.report')).toBe('Rapport');
    expect(fr('tabs.settings')).toBe('Settings');
  });
});
