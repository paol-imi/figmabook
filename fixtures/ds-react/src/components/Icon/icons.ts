import { ArrowRight, Check, ChevronDown, type IconNode, Info, Plus, Search, Star, X } from 'lucide';

/**
 * The eight icons of the fixture design system. The path data comes from Lucide
 * (https://lucide.dev, ISC License; the notice ships in the `lucide` package).
 * Names are API: stories, tests and Figma component names use them. Add, never rename.
 */
export const icons = {
  'arrow-right': ArrowRight,
  check: Check,
  'chevron-down': ChevronDown,
  info: Info,
  plus: Plus,
  search: Search,
  star: Star,
  x: X,
} as const satisfies Record<string, IconNode>;

export type IconName = keyof typeof icons;

/** Every icon name, in alphabetical order. */
export const iconNames = Object.keys(icons).sort() as IconName[];
