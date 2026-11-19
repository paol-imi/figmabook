export {
  ASSUMPTION_IDS,
  ASSUMPTIONS,
  type Assumption,
  type AssumptionId,
  type AssumptionStatus,
  type SpikeId,
} from './assumptions';
export { compareRects, type RectComparison, type RectDelta, type RectField, TOL_SIM, withinTolerance } from './compare';
export type { SimIssue, SimIssueCode } from './issues';
export { fallbackRects, type SceneSimOptions, simulateScene, toSimNode } from './scene';
export {
  DEFAULT_FRAME_KEY,
  measureHug,
  type StackFrame,
  simulate,
  simulateAutoLayout,
  simulateGrid,
} from './simulate';
export type {
  PrimaryAxisAlign,
  SceneGridLayout,
  SceneStackLayout,
  SimNode,
  SimResult,
  SimulateOptions,
  Simulation,
  SizeBounds,
  Sizing,
  StackSpec,
  StrokeBox,
} from './types';
export { SIMULATOR_VERSION } from './version';
