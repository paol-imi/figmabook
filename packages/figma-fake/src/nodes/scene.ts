import { figmaError, unsupported } from '../errors';
import { live } from '../state';
import { checkBoolean, deepFreeze, normalizeConstraints } from '../values';
import type { Ctor } from './core';
import { assign } from './props';

/** `ExplicitVariableModesMixin` (typings:10586-10620). Modes are B-139; no node has explicit modes yet. */
export function WithExplicitModes<B extends Ctor>(Base: B) {
  return class extends Base implements ExplicitVariableModesMixin {
    get explicitVariableModes(): { [collectionId: string]: string } {
      live(this);
      return {};
    }

    set explicitVariableModes(_value: { [collectionId: string]: string }) {
      unsupported('explicitVariableModes', 'B-139');
    }

    clearExplicitVariableModeForCollection(_collection: string | VariableCollection): void {
      unsupported('clearExplicitVariableModeForCollection', 'B-139');
    }

    setExplicitVariableModeForCollection(_collection: string | VariableCollection, _modeId: string): void {
      unsupported('setExplicitVariableModeForCollection', 'B-139');
    }
  };
}

/** `MotionNodeMixin` (typings:6808-7016): Motion is not modelled. */
export function WithMotion<B extends Ctor>(Base: B) {
  return class extends Base implements MotionNodeMixin {
    get animationStyles(): AppliedAnimationStyle[] {
      return unsupported('animationStyles', 'hardening');
    }

    get animations(): Animations {
      return unsupported('animations', 'hardening');
    }

    get manualKeyframeTracks(): ManualKeyframeTracks {
      return unsupported('manualKeyframeTracks', 'hardening');
    }

    get timelines(): ReadonlyArray<Timeline> {
      return unsupported('timelines', 'hardening');
    }

    applyAnimationStyle(_styleId: string, _data?: AnimationStyleConfiguration): string {
      return unsupported('applyAnimationStyle', 'hardening');
    }

    removeAnimationStyle(_id: string): void {
      unsupported('removeAnimationStyle', 'hardening');
    }

    applyManualKeyframeTrack(_field: KeyframeField, _track: ManualKeyframeTrackInput): void {
      unsupported('applyManualKeyframeTrack', 'hardening');
    }

    removeManualKeyframeTrack(_field: KeyframeField): void {
      unsupported('removeManualKeyframeTrack', 'hardening');
    }

    setTimelineDuration(_id: string, _duration: number): void {
      unsupported('setTimelineDuration', 'hardening');
    }
  };
}

/** `SceneNodeMixin` own members (typings:6642-6806). */
export function WithScene<B extends Ctor>(Base: B) {
  return class extends Base {
    get visible(): boolean {
      return live(this).visible;
    }

    set visible(value: boolean) {
      assign(this, 'visible', checkBoolean('set_visible', 'visible', value));
    }

    get locked(): boolean {
      return live(this).locked;
    }

    set locked(value: boolean) {
      assign(this, 'locked', checkBoolean('set_locked', 'locked', value));
    }

    /** FigJam only: always empty in Figma Design. */
    get stuckNodes(): SceneNode[] {
      live(this);
      return [];
    }

    /** FigJam only: always empty in Figma Design. */
    get attachedConnectors(): ConnectorNode[] {
      live(this);
      return [];
    }

    get componentPropertyReferences():
      | { [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string }
      | null {
      live(this);
      return null;
    }

    set componentPropertyReferences(_value:
      | {
          [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string;
        }
      | null) {
      unsupported('componentPropertyReferences');
    }

    /** No variables exist before B-54, so no node has bindings. */
    get boundVariables(): NonNullable<SceneNodeMixin['boundVariables']> {
      live(this);
      return {};
    }

    setBoundVariable(
      _field: VariableBindableNodeField | VariableBindableTextField,
      _variable: string | Variable | null,
    ): void {
      unsupported('setBoundVariable');
    }

    get resolvedVariableModes(): { [collectionId: string]: string } {
      live(this);
      return {};
    }

    set resolvedVariableModes(_value: { [collectionId: string]: string }) {
      unsupported('resolvedVariableModes', 'B-139');
    }
  };
}

/** `ExportMixin` (typings:9040-9139). The PNG placeholder of `exportAsync` is B-54. */
export function WithExport<B extends Ctor>(Base: B) {
  return class extends Base implements ExportMixin {
    get exportSettings(): ReadonlyArray<ExportSettings> {
      return live(this).exportSettings;
    }

    set exportSettings(value: ReadonlyArray<ExportSettings>) {
      if (!Array.isArray(value)) throw figmaError('set_exportSettings', 'Expected an array');
      assign(this, 'exportSettings', deepFreeze(structuredClone([...value])));
    }

    exportAsync(
      _settings?:
        | ExportSettings
        | ExportSettingsSVGString
        | ExportSettingsREST
        | ExportSettingsMP4
        | ExportSettingsGIF
        | ExportSettingsWEBM,
    ): Promise<never> {
      return unsupported('exportAsync');
    }
  };
}

/** `ReactionMixin` (typings:9193-9362): prototyping is not modelled. */
export function WithReactions<B extends Ctor>(Base: B) {
  return class extends Base implements ReactionMixin {
    get reactions(): ReadonlyArray<Reaction> {
      live(this);
      return Object.freeze([]);
    }

    set reactions(_value: ReadonlyArray<Reaction>) {
      unsupported('reactions', 'hardening');
    }

    setReactionsAsync(_reactions: Array<Reaction>): Promise<void> {
      return unsupported('setReactionsAsync', 'hardening');
    }
  };
}

/** `AnnotationsMixin` (typings:9547-9586): stored, not interpreted (B-130 adds categories). */
export function WithAnnotations<B extends Ctor>(Base: B) {
  return class extends Base implements AnnotationsMixin {
    get annotations(): ReadonlyArray<Annotation> {
      return live(this).annotations;
    }

    set annotations(value: ReadonlyArray<Annotation>) {
      if (!Array.isArray(value)) throw figmaError('set_annotations', 'Expected an array');
      assign(this, 'annotations', deepFreeze(structuredClone([...value])));
    }
  };
}

/** `AspectRatioLockMixin` (typings:7545-7596). */
export function WithAspectRatioLock<B extends Ctor>(Base: B) {
  return class extends Base implements AspectRatioLockMixin {
    get targetAspectRatio(): Vector | null {
      return live(this).targetAspectRatio;
    }

    lockAspectRatio(): void {
      const state = live(this);
      state.targetAspectRatio = deepFreeze({ x: state.width, y: state.height });
      state.ctx.record(state, 'lockAspectRatio');
    }

    unlockAspectRatio(): void {
      const state = live(this);
      state.targetAspectRatio = null;
      state.ctx.record(state, 'unlockAspectRatio');
    }
  };
}

/** `DevStatusMixin` (typings:6629-6640): only on nodes directly under a page or section. */
export function WithDevStatus<B extends Ctor>(Base: B) {
  return class extends Base implements DevStatusMixin {
    get devStatus(): DevStatus {
      return live(this).devStatus;
    }

    set devStatus(value: DevStatus) {
      const state = live(this);
      const parentType = state.parent?.type;
      if (value !== null && parentType !== 'PAGE' && parentType !== 'SECTION') {
        throw figmaError('set_devStatus', 'devStatus can only be set on a node directly under a page or section');
      }
      assign(this, 'devStatus', value === null ? null : deepFreeze({ ...value }));
    }
  };
}

/** `ConstraintMixin` (typings:7283-7292). Constraint objects are frozen (09 §6.2 "immutable"). */
export function WithConstraints<B extends Ctor>(Base: B) {
  return class extends Base implements ConstraintMixin {
    get constraints(): Constraints {
      return live(this).constraints;
    }

    set constraints(value: Constraints) {
      assign(this, 'constraints', normalizeConstraints('set_constraints', value));
    }
  };
}
