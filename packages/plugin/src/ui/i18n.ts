/*
 * The UI message catalog (11 §6.13). Every user-visible string goes through `t()` so
 * locales can be added without code changes. Messages use a subset of ICU MessageFormat:
 * `{name}` arguments and `{n, plural, =0 {…} one {# …} other {# …}}` with `#` for the number.
 */
import en from './messages/en.json';

export type Catalog = Readonly<Record<string, string>>;
export type MessageKey = keyof typeof en;
export type MessageArgs = Readonly<Record<string, string | number>>;

export class MessageFormatError extends Error {
  override readonly name = 'MessageFormatError';
}

/** Index of the `}` that closes the `{` at `open`. */
function closingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new MessageFormatError(`Unbalanced braces in message "${source}".`);
}

/** Parses `=0 {…} one {…} other {…}` into selector → sub-message. */
function pluralOptions(source: string): Map<string, string> {
  const options = new Map<string, string>();
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf('{', i);
    if (open === -1) {
      if (source.slice(i).trim() !== '') throw new MessageFormatError(`Stray text in plural "${source}".`);
      break;
    }
    const selector = source.slice(i, open).trim();
    const close = closingBrace(source, open);
    if (selector === '') throw new MessageFormatError(`Missing plural selector in "${source}".`);
    options.set(selector, source.slice(open + 1, close));
    i = close + 1;
  }
  if (!options.has('other')) throw new MessageFormatError(`Plural without an "other" case in "${source}".`);
  return options;
}

function argument(args: MessageArgs, name: string, message: string): string | number {
  const value = args[name];
  if (value === undefined) throw new MessageFormatError(`Missing argument "${name}" for message "${message}".`);
  return value;
}

/** Formats an ICU-subset message. Throws {@link MessageFormatError} on bad syntax or a missing argument. */
export function formatMessage(message: string, args: MessageArgs = {}, locale = 'en', pound?: string): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const char = message[i];
    if (char === '#' && pound !== undefined) {
      out += pound;
      i += 1;
    } else if (char === '{') {
      const close = closingBrace(message, i);
      const [name = '', type, ...rest] = message.slice(i + 1, close).split(',');
      const key = name.trim();
      if (type === undefined) {
        out += String(argument(args, key, message));
      } else if (type.trim() === 'plural') {
        const count = Number(argument(args, key, message));
        const options = pluralOptions(rest.join(','));
        const selected =
          options.get(`=${count}`) ?? options.get(new Intl.PluralRules(locale).select(count)) ?? options.get('other');
        out += formatMessage(selected ?? '', args, locale, new Intl.NumberFormat(locale).format(count));
      } else {
        throw new MessageFormatError(`Unsupported argument type "${type.trim()}" in "${message}".`);
      }
      i = close + 1;
    } else if (char === '}') {
      throw new MessageFormatError(`Unbalanced braces in message "${message}".`);
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

export type Translate = (key: MessageKey, args?: MessageArgs) => string;

/** A translator over `catalog`, falling back to English for keys a locale lacks. */
export function createTranslator(catalog: Catalog = en, locale = 'en'): Translate {
  return (key, args) => formatMessage(catalog[key] ?? en[key], args, locale);
}

/** The English translator. v1 ships English only (11 §6.13). */
export const t: Translate = createTranslator();
