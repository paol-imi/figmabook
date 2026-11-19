import type { TopLevel } from '../identify/snapshot-index';
import { dcrDiagnostic, type ItemDraft } from './context';
import { DOT } from './text';

/*
 * Top-level frames in scope are screens (15 §4.6, §4.10). Usage trees, breakpoints and states
 * are built by the screens stage; until a frame is extracted as a `screen`, it is listed as
 * `unknown` (`DCR_UNKNOWN_CHANGE`) so it is never silently dropped.
 */

export function unextractedFrame({ node }: TopLevel): ItemDraft {
  return {
    item: {
      kind: 'unknown',
      title: `Frame "${node.name}" ${DOT} unclassified change: new frame`,
      designerTitle: `New frame ${node.name}`,
      target: { figmaNodeId: node.id },
      acceptance: { type: 'structure', story: 'existing' },
      diagnostics: [dcrDiagnostic('DCR_UNKNOWN_CHANGE', { property: 'frame', value: node.name })],
    },
    before: false,
    questions: [],
    headline: `${node.name}: 1 change Holotype cannot classify (new frame)`,
  };
}
