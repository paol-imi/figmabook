import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, Button, Card, Icon, Input, iconNames, Stack } from '../../src/index.ts';
import { cx } from '../../src/utils/cx.ts';

/** Server-renders to markup: these checks only need attributes and text, so no DOM is needed. */
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('cx', () => {
  it('joins truthy class names in order', () => {
    expect(cx('a', undefined, false, null, '', 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('Button', () => {
  it('renders a type="button" with its label and no icon by default', () => {
    const out = html(<Button label="Save" />);
    expect(out).toMatch(/^<button type="button"/);
    expect(out).toContain('>Save</span>');
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('disabled');
  });

  it('shows the leading icon only with showIcon', () => {
    expect(html(<Button label="Add" showIcon iconLeading="check" />)).toContain('data-icon="check"');
    expect(html(<Button label="Add" iconLeading="check" />)).not.toContain('data-icon');
  });

  it('replaces the icon with a spinner and blocks clicks while loading', () => {
    const out = html(<Button label="Saving" loading showIcon />);
    expect(out).toContain('data-part="spinner"');
    expect(out).not.toContain('data-icon');
    expect(out).toContain('disabled=""');
    expect(out).toContain('aria-busy="true"');
  });

  it('is disabled with disabled', () => {
    expect(html(<Button label="No" disabled />)).toContain('disabled=""');
  });
});

describe('Badge', () => {
  it('renders the label, with a dot only when asked', () => {
    expect(html(<Badge label="New" />)).toMatch(/^<span class="[^"]+">New<\/span>$/);
    expect(html(<Badge label="Online" dot />)).toContain('data-part="dot"');
  });
});

describe('Input', () => {
  it('links the label and the helper text to the field', () => {
    const out = html(<Input id="email" label="Email" helperText="Hint" placeholder="you@example.com" />);
    expect(out).toContain('<label class="');
    expect(out).toContain('for="email"');
    expect(out).toContain('aria-describedby="email-message"');
    expect(out).toContain('id="email-message"');
    expect(out).toContain('placeholder="you@example.com"');
  });

  it('marks the field invalid and shows the error instead of the hint', () => {
    const out = html(<Input id="e" label="Email" helperText="Hint" error="Bad address" />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('Bad address');
    expect(out).not.toContain('Hint');
  });

  it('omits the message element for an empty hint', () => {
    expect(html(<Input id="e" label="Search" helperText="" />)).not.toContain('aria-describedby');
  });

  it('renders the value, the prefix icon and the disabled state', () => {
    const out = html(<Input id="e" label="Search" value="query" prefixIcon="search" disabled />);
    expect(out).toContain('value="query"');
    expect(out).toContain('data-icon="search"');
    expect(out).toContain('disabled=""');
  });
});

describe('Card', () => {
  it('renders the media image and an actions slot only when given', () => {
    const bare = html(<Card title="T" body="B" />);
    expect(bare).not.toContain('<img');
    expect(bare).not.toContain('data-slot');
    const full = html(
      <Card title="T" body="B" media="/m.png">
        <Button label="Open" />
      </Card>,
    );
    expect(full).toContain('<img class="');
    expect(full).toContain('src="/m.png"');
    expect(full).toContain('data-slot="actions"');
  });
});

describe('Stack', () => {
  it('renders one flex container around its children', () => {
    const out = html(
      <Stack direction="row" gap={4} wrap>
        <span>a</span>
        <span>b</span>
      </Stack>,
    );
    expect(out).toMatch(/^<div class="[^"]+"><span>a<\/span><span>b<\/span><\/div>$/);
  });
});

describe('Icon', () => {
  it('has eight icons', () => {
    expect(iconNames).toEqual(['arrow-right', 'check', 'chevron-down', 'info', 'plus', 'search', 'star', 'x']);
  });

  it.each(iconNames)('%s draws with currentColor and is decorative without a label', (name) => {
    const out = html(<Icon name={name} />);
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toMatch(/<(path|circle)\s/);
  });

  it('is an image with a title when labelled', () => {
    const out = html(<Icon name="info" label="Information" />);
    expect(out).toContain('role="img"');
    expect(out).toContain('<title>Information</title>');
    expect(out).not.toContain('aria-hidden');
  });
});
