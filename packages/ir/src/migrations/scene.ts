import { APPLY_IR_VERSION_UNSUPPORTED, createDiagnostic, type Diagnostic, err, ok, type Result } from '@holotype/shared';
import { parseMajor, SUPPORTED_SCENE_MAJORS } from '../versions';

/** A pure `vN → vN+1` step (06 §7). There are none before Scene IR 1.0. */
type SceneMigration = (doc: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: ReadonlyMap<number, SceneMigration> = new Map();

const CURRENT_MAJOR = Math.max(...SUPPORTED_SCENE_MAJORS);

/**
 * Upgrades a Scene IR document of any supported major to the current major. The result
 * is not schema-checked: pass it to `validateSceneComponent()` next.
 */
export function migrateScene(doc: unknown): Result<Record<string, unknown>, readonly Diagnostic[]> {
  const version = isRecord(doc) && typeof doc.sceneVersion === 'string' ? doc.sceneVersion : undefined;
  const major = version === undefined ? undefined : parseMajor(version);
  if (!isRecord(doc) || major === undefined || !SUPPORTED_SCENE_MAJORS.includes(major)) {
    return err([
      createDiagnostic(APPLY_IR_VERSION_UNSUPPORTED, {
        document: 'Scene IR',
        found: version ?? 'unknown',
        supported: SUPPORTED_SCENE_MAJORS.join(', '),
      }),
    ]);
  }
  let current = doc;
  for (let from = major; from < CURRENT_MAJOR; from++) {
    const step = MIGRATIONS.get(from);
    if (!step) throw new Error(`Missing Scene IR migration ${from} → ${from + 1}.`);
    current = step(current);
  }
  return ok(current);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
