import { createHash } from 'node:crypto';
import { figmaError, unsupported } from '../errors';
import { live, type NodeState } from '../state';
import { checkString, deepFreeze } from '../values';
import type { Ctor } from './core';
import { assign } from './props';

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

/** Parses a variant name such as `Size=Large, State=Hover` (typings:9670-9715). */
export function parseVariantName(name: string): Record<string, string> | null {
  const properties: Record<string, string> = {};
  for (const part of name.split(',')) {
    const at = part.indexOf('=');
    if (at <= 0) return null;
    properties[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return properties;
}

export function variantPropertiesOf(state: NodeState): { [property: string]: string } | null {
  if (state.parent?.type !== 'COMPONENT_SET') return null;
  return parseVariantName(state.name);
}

/** `VariantMixin` (typings:9670-9716): `null` for components outside a component set. */
export function WithVariant<B extends Ctor>(Base: B) {
  return class extends Base implements VariantMixin {
    get variantProperties(): { [property: string]: string } | null {
      return variantPropertiesOf(live(this));
    }
  };
}

/** `ComponentPropertiesMixin` (typings:9717-9766): component properties are B-54. */
export function WithComponentProperties<B extends Ctor>(Base: B) {
  return class extends Base implements ComponentPropertiesMixin {
    get componentPropertyDefinitions(): ComponentPropertyDefinitions {
      return unsupported('componentPropertyDefinitions');
    }

    addComponentProperty(
      _propertyName: string,
      _type: ComponentPropertyType,
      _defaultValue: string | boolean | VariableAlias,
      _options?: ComponentPropertyOptions,
    ): string {
      return unsupported('addComponentProperty');
    }

    editComponentProperty(
      _propertyName: string,
      _newValue: {
        name?: string;
        defaultValue?: string | boolean | VariableAlias;
        preferredValues?: InstanceSwapPreferredValue[];
      },
    ): string {
      return unsupported('editComponentProperty');
    }

    deleteComponentProperty(_propertyName: string): void {
      unsupported('deleteComponentProperty');
    }
  };
}
