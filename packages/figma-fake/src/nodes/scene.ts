import { referencesOf, setReferences } from '../components/properties';
import { figmaError, unsupported } from '../errors';
import { exportNode } from '../export';
import { live } from '../state';
import { checkBoolean, deepFreeze, normalizeConstraints } from '../values';
import {
  bindNodeField,
  bindTextRange,
  boundVariablesOf,
  isNodeField,
  isTextField,
  variableArg,
} from '../variables/bindings';
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

    /** `null` unless the node is a component or instance sublayer (typings:6682-6690). */
    get componentPropertyReferences():
      | { [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string }
      | null {
      return referencesOf(live(this));
    }

    /** Binds fields to the containing component's properties (09 §8.1); names must exist with the matching type. */
    set componentPropertyReferences(value:
      | {
          [nodeProperty in 'visible' | 'characters' | 'mainComponent']?: string;
        }
      | null) {
      const state = live(this);
      state.propertyRefs = setReferences(state, value);
      state.ctx.record(state, 'set', 'componentPropertyReferences', value);
    }

    /** Variables bound to the node's fields, paints and component properties (typings:6700-6716). */
    get boundVariables(): NonNullable<SceneNodeMixin['boundVariables']> {
      return boundVariablesOf(live(this));
    }

    /**
     * Binds `field` to `variable`, or unbinds it with `null` (typings:6717-6740). Text fields bind
     * the whole text; node fields must exist on the node and take the variable's type.
     */
    setBoundVariable(
      field: VariableBindableNodeField | VariableBindableTextField,
      variable: string | Variable | null,
    ): void {
      const state = live(this);
      const api = 'setBoundVariable';
      const store = state.ctx.variables;
      const target = variableArg(api, store, variable);
      if (isTextField(field)) {
        if (!state.text) throw figmaError(api, `"${field}" can only be bound on text nodes`);
        bindTextRange(state, store, 0, state.text.characters.length, field, target);
      } else if (isNodeField(field)) {
        bindNodeField(this, state, store, field, target);
      } else {
        throw figmaError(api, `Invalid field "${String(field)}"`);
      }
      state.ctx.record(state, api, field, target ? target.id : null);
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

/** `ExportMixin` (typings:9040-9139); `exportAsync` returns a placeholder (`export.ts`). */
export function WithExport<B extends Ctor>(Base: B) {
  return class extends Base implements ExportMixin {
    get exportSettings(): ReadonlyArray<ExportSettings> {
      return live(this).exportSettings;
    }

    set exportSettings(value: ReadonlyArray<ExportSettings>) {
      if (!Array.isArray(value)) throw figmaError('set_exportSettings', 'Expected an array');
      assign(this, 'exportSettings', deepFreeze(structuredClone([...value])));
    }

    exportAsync(settings?: ExportSettings): Promise<Uint8Array>;
    exportAsync(settings: ExportSettingsSVGString): Promise<string>;
    exportAsync(settings: ExportSettingsREST): Promise<object>;
    exportAsync(settings: ExportSettingsMP4 | ExportSettingsGIF | ExportSettingsWEBM): Promise<Uint8Array>;
    /** A deterministic placeholder of the node's export (BUILD §8.1 "Export"; see `export.ts`). */
    async exportAsync(
      settings?:
        | ExportSettings
        | ExportSettingsSVGString
        | ExportSettingsREST
        | ExportSettingsMP4
        | ExportSettingsGIF
        | ExportSettingsWEBM,
    ): Promise<Uint8Array | string | object> {
      return exportNode(live(this), settings);
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
