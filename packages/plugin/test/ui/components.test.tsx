// @vitest-environment happy-dom
import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
// biome-ignore lint/correctness/noUnusedImports: JSX compiles to the classic `h()` factory.
import { h } from 'preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../src/ui/components/Button';
import { EmptyState, ErrorState, LoadingState, SuccessState } from '../../src/ui/components/StateView';
import { Tabs } from '../../src/ui/components/Tabs';

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
] as const;

function TabsHarness() {
  const [selected, setSelected] = useState<'a' | 'b' | 'c'>('a');
  return (
    <Tabs label="Sections" items={items} selected={selected} onSelect={setSelected}>
      <p>Panel {selected}</p>
    </Tabs>
  );
}

describe('Tabs (WAI-ARIA tabs, 11 §6.13)', () => {
  it('exposes a labelled tablist with one selected tab controlling the panel', () => {
    render(<TabsHarness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const alpha = screen.getByRole('tab', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'Alpha' });
    expect(alpha).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Panel a');
  });

  it('has a single tab stop: Tab goes from the selected tab into the panel', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('moves and selects with arrow keys, wrapping, and Home/End', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    await user.click(screen.getByRole('tab', { name: 'Alpha' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel b');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    await user.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel c');
  });
});

describe('Button', () => {
  it('is a real button that runs on Enter and Space', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Retry</Button>);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(button).toHaveAttribute('type', 'button');
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Retry
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('state views (D-40, 11 §6.11)', () => {
  it('empty: a named region with a heading, body and actions, and no live region', () => {
    render(<EmptyState title="Nothing yet" body={<p>Do this next.</p>} actions={<button type="button">Go</button>} />);
    const region = screen.getByRole('region', { name: 'Nothing yet' });
    expect(screen.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Do this next.');
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('loading: a busy status with an optional labelled progress bar', () => {
    render(<LoadingState title="Importing" body={<p>Step 2</p>} progress={{ done: 2, total: 5 }} />);
    const status = screen.getByRole('status', { name: 'Importing' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    const bar = screen.getByRole('progressbar', { name: 'Importing' });
    expect(bar).toHaveAttribute('value', '2');
    expect(bar).toHaveAttribute('max', '5');
  });

  it('loading without progress shows no progress bar', () => {
    render(<LoadingState title="Starting" />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('error: an alert that names the diagnostic code, with text and icon, not color alone', () => {
    render(<ErrorState title="It broke" body={<p>Because.</p>} code="NET_SERVER_UNREACHABLE" />);
    const alert = screen.getByRole('alert', { name: 'It broke' });
    expect(alert).toHaveTextContent('Because.');
    expect(alert).toHaveTextContent('Code NET_SERVER_UNREACHABLE');
    expect(alert.querySelector('[aria-hidden="true"]')).toHaveTextContent('!');
  });

  it('success: a status with a check icon', () => {
    render(<SuccessState title="Done" />);
    expect(screen.getByRole('status', { name: 'Done' }).querySelector('[aria-hidden="true"]')).toHaveTextContent('✓');
  });
});
