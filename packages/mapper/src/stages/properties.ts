import type { ComponentPlan, PlanAxis, PropSource, ProvenanceTag, ScenePropertyDef } from '@holotype/ir';
import { plainDiagnostic } from '../diagnostics';
import type { ComponentStage } from './types';

/*
 * Stage 11, component property binding (07 §14). VARIANT properties come from the plan's
 * axes; a single-variant component is a plain COMPONENT and has none. BOOLEAN, TEXT,
 * INSTANCE_SWAP and SLOT properties need cross-variant alignment to find their layers
 * (B-50); until then each one is unbound, so it is dropped with `PLAN_PROPERTY_UNBOUND`.
 */

const SOURCE_KIND: Readonly<Record<PlanAxis['source']['kind'], PropSource['kind']>> = {
  arg: 'arg',
  story: 'story',
  state: 'state',
  viewport: 'viewport',
  global: 'global',
  custom: 'synthetic',
};

/** How the planner knew (04 §1) → the evidence a property records (D-13). */
function evidence(tag: ProvenanceTag | undefined): PropSource['evidence'] {
  if (tag === 'verified-diff') return 'render-diff';
  if (tag === 'heuristic') return 'type-only';
  return 'declared';
}

function variantProperty(axis: PlanAxis, plan: ComponentPlan): ScenePropertyDef {
  const values = axis.values.map((value) => value.label);
  const source: PropSource = {
    kind: SOURCE_KIND[axis.source.kind],
    classification: 'VARIANT',
    evidence: evidence(plan.provenance[axis.id]),
  };
  if (axis.source.kind === 'arg') {
    const arg = axis.source.arg;
    source.argName = arg;
    const valueMap = axis.values.flatMap((value) => {
      const argValue = value.bind.args?.[arg];
      return argValue === undefined ? [] : [{ figma: value.label, arg: argValue }];
    });
    if (valueMap.length > 0) source.valueMap = valueMap;
  }
  if (axis.source.kind === 'global') source.globalName = axis.source.global;
  return { type: 'VARIANT', key: axis.id, name: axis.name, values, defaultValue: values[0] ?? '', source };
}

export const propertiesStage: ComponentStage = {
  step: 11,
  name: 'properties',
  per: 'component',
  run(component) {
    const { plan, sid } = component.input;
    const isSet = component.variants.length > 1;
    component.properties = isSet
      ? plan.axes.filter((axis) => axis.values.length > 0).map((axis) => variantProperty(axis, plan))
      : [];
    for (const property of plan.properties) {
      component.diagnostics.push(
        plainDiagnostic('PLAN_PROPERTY_UNBOUND', {
          sid,
          property: property.name,
          fallback: 'property dropped',
          data: { arg: property.arg, kind: property.kind },
        }),
      );
    }
  },
};
