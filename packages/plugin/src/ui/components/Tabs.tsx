// biome-ignore lint/correctness/noUnusedImports: create-figma-plugin compiles JSX to the classic `h()` factory.
import { type ComponentChildren, h } from 'preact';
import { useRef } from 'preact/hooks';
import styles from './Tabs.module.css';

export interface TabItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface TabsProps<Id extends string> {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly items: readonly TabItem<Id>[];
  readonly selected: Id;
  readonly onSelect: (id: Id) => void;
  /** Renders the panel of the selected tab. */
  readonly children: ComponentChildren;
}

export const tabId = (id: string): string => `holotype-tab-${id}`;
export const panelId = (id: string): string => `holotype-panel-${id}`;

/**
 * WAI-ARIA tabs with automatic activation: one tab stop (roving `tabindex`); Arrow
 * Left/Right move and select, wrapping; Home/End jump to the ends (11 §6.13).
 */
export function Tabs<Id extends string>({ label, items, selected, onSelect, children }: TabsProps<Id>) {
  const list = useRef<HTMLDivElement>(null);

  const move = (index: number) => {
    const item = items[(index + items.length) % items.length];
    if (item === undefined) return;
    onSelect(item.id);
    list.current?.querySelector<HTMLElement>(`#${tabId(item.id)}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.findIndex((item) => item.id === selected);
    const target = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    move(target);
  };

  return (
    <div class={styles.root}>
      <div ref={list} role="tablist" aria-label={label} class={styles.list} onKeyDown={onKeyDown}>
        {items.map((item) => {
          const active = item.id === selected;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabId(item.id)}
              aria-selected={active}
              aria-controls={panelId(item.id)}
              tabIndex={active ? 0 : -1}
              class={styles.tab}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA APG tabs: the panel is a tab stop when its content may have nothing focusable. */}
      <div role="tabpanel" id={panelId(selected)} aria-labelledby={tabId(selected)} tabIndex={0} class={styles.panel}>
        {children}
      </div>
    </div>
  );
}
