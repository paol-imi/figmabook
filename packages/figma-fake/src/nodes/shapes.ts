import { figmaError, unsupported } from '../errors';
import { live } from '../state';
import { checkEnum, checkNumber, checkString, deepFreeze } from '../values';
import type { Ctor } from './core';
import { assign } from './props';

/** `VectorLikeMixin` (typings:9170-9189). Vector networks are B-54 (SVG → vectors). */
export function WithVectorLike<B extends Ctor>(Base: B) {
  return class extends Base implements VectorLikeMixin {
    get vectorNetwork(): VectorNetwork {
      return unsupported('VectorNode.vectorNetwork');
    }

    /** Read-only under `documentAccess: "dynamic-page"` (typings:9174). */
    set vectorNetwork(_value: VectorNetwork) {
      throw figmaError(
        'set_vectorNetwork',
        'Cannot call with documentAccess: dynamic-page. Use node.setVectorNetworkAsync instead.',
      );
    }

    setVectorNetworkAsync(_vectorNetwork: VectorNetwork): Promise<void> {
      return unsupported('VectorNode.setVectorNetworkAsync');
    }

    get vectorPaths(): VectorPaths {
      return live(this).vectorPaths;
    }

    /** Each path is `{ windingRule, data }` (typings:5475-5508). Path data is stored, not parsed. */
    set vectorPaths(value: VectorPaths) {
      const api = 'set_vectorPaths';
      if (!Array.isArray(value)) throw figmaError(api, 'Expected an array of vector paths');
      const paths = value.map((path: VectorPath) => ({
        windingRule: checkEnum(api, 'windingRule', path?.windingRule, ['NONZERO', 'EVENODD', 'NONE']),
        data: checkString(api, 'data', path.data),
      }));
      assign(this, 'vectorPaths', deepFreeze(paths));
    }

    get handleMirroring(): HandleMirroring | PluginAPI['mixed'] {
      return live(this).handleMirroring;
    }

    set handleMirroring(value: HandleMirroring | PluginAPI['mixed']) {
      const mode = checkEnum('set_handleMirroring', 'handleMirroring', value, ['NONE', 'ANGLE', 'ANGLE_AND_LENGTH']);
      assign(this, 'handleMirroring', mode);
    }
  };
}

/** `EllipseNode.arcData` (typings:10931-10934, 4343-4350). */
export function WithArcData<B extends Ctor>(Base: B) {
  return class extends Base {
    get arcData(): ArcData {
      return live(this).arcData;
    }

    set arcData(value: ArcData) {
      const api = 'set_arcData';
      const arc = {
        startingAngle: checkNumber(api, 'startingAngle', value?.startingAngle),
        endingAngle: checkNumber(api, 'endingAngle', value.endingAngle),
        innerRadius: checkNumber(api, 'innerRadius', value.innerRadius, 0),
      };
      if (arc.innerRadius > 1) throw figmaError(api, 'Expected "innerRadius" to be <= 1');
      assign(this, 'arcData', deepFreeze(arc));
    }
  };
}
