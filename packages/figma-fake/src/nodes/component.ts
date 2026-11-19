import { createHash } from 'node:crypto';
import {
  addProperty,
  definitionsOf,
  deleteProperty,
  editProperty,
  parseVariantName,
  requireOwner,
  variantPropertiesOf,
} from '../components/properties';
import { figmaError } from '../errors';
import { live } from '../state';
import { checkString, deepFreeze } from '../values';
import type { Ctor } from './core';
import { assign } from './props';

export { parseVariantName, variantPropertiesOf };

/** `PublishableMixin` (typings:9364-9414) for components and component sets. */
export function WithPublishable<B extends Ctor>(Base: B) {
  return class extends Base implements PublishableMixin {
    get description(): string {
      return live(this).description;
    }

    set description(value: string) {
      assign(this, 'description', checkString('set_description', 'description', value));
    }

    get descriptionMarkdown(): string {
      return live(this).descriptionMarkdown;
    }

    set descriptionMarkdown(value: string) {
      assign(this, 'descriptionMarkdown', checkString('set_descriptionMarkdown', 'descriptionMarkdown', value));
    }

    get documentationLinks(): ReadonlyArray<DocumentationLink> {
      return live(this).documentationLinks;
    }

    /** "This API currently only supports setting a single documentation link" (typings:9387-9399). */
    set documentationLinks(value: ReadonlyArray<DocumentationLink>) {
      const api = 'set_documentationLinks';
      if (!Array.isArray(value)) throw figmaError(api, 'Expected an array of documentation links');
      if (value.length > 1) throw figmaError(api, 'Only a single documentation link is supported');
      const links = value.map((link: DocumentationLink) => ({ uri: checkString(api, 'uri', link?.uri) }));
      assign(this, 'documentationLinks', deepFreeze(links));
    }

    /** Local components only: remote (library) components arrive with B-142. */
    get remote(): boolean {
      live(this);
      return false;
    }

    /** A stable 40-hex key per node (local components have keys too, typings:9405-9408). */
    get key(): string {
      const state = live(this);
      return createHash('sha1').update(`holotype-fake-key:${state.id}`).digest('hex');
    }

    async getPublishStatusAsync(): Promise<PublishStatus> {
      live(this);
      return 'UNPUBLISHED';
    }
  };
}

/**
 * `VariantMixin` (typings:9670-9716): `null` for components outside a component set; an instance
 * reports its main component's values.
 */
export function WithVariant<B extends Ctor>(Base: B) {
  return class extends Base implements VariantMixin {
    get variantProperties(): { [property: string]: string } | null {
      const state = live(this);
      const component = state.type === 'INSTANCE' ? state.mainComponent : state;
      return component ? variantPropertiesOf(component) : null;
    }
  };
}

/** `ComponentPropertiesMixin` (typings:9717-9766), on component sets and components (see `components/properties.ts`). */
export function WithComponentProperties<B extends Ctor>(Base: B) {
  return class extends Base implements ComponentPropertiesMixin {
    get componentPropertyDefinitions(): ComponentPropertyDefinitions {
      const state = live(this);
      requireOwner('componentPropertyDefinitions', state);
      return definitionsOf(state);
    }

    addComponentProperty(
      propertyName: string,
      type: ComponentPropertyType,
      defaultValue: string | boolean | VariableAlias,
      options?: ComponentPropertyOptions,
    ): string {
      const state = live(this);
      const name = addProperty(state, propertyName, type, defaultValue, options);
      state.ctx.record(state, 'addComponentProperty', null, { name, type, defaultValue, options: options ?? null });
      return name;
    }

    editComponentProperty(
      propertyName: string,
      newValue: {
        name?: string;
        defaultValue?: string | boolean | VariableAlias;
        preferredValues?: InstanceSwapPreferredValue[];
        description?: string;
        slotSettings?: SlotSettings;
      },
    ): string {
      const state = live(this);
      const name = editProperty(state, propertyName, newValue);
      state.ctx.record(state, 'editComponentProperty', propertyName, newValue);
      return name;
    }

    deleteComponentProperty(propertyName: string): void {
      const state = live(this);
      deleteProperty(state, propertyName);
      state.ctx.record(state, 'deleteComponentProperty', propertyName, null);
    }
  };
}
