import { type Diagnostic, err, ok, type Result } from '@holotype/shared';
import { checkVersion, parseMajor, SUPPORTED_SCENE_MAJORS } from '../../versions';

/**
 * A pure Scene IR step from major `from` to `from + 1` (06 §7). Each lives in its own file
 * here, `<from>-<to>.ts`, and is listed in `SCENE_MIGRATIONS`. The plugin bundles the
 * steps for the current and the previous major. There are none before Scene IR 1.0.
 */
export type SceneMigration = (doc: Readonly<Record<string, unknown>>) => Record<string, unknown>;

/** Registered steps, keyed by the major they upgrade from. */
export const SCENE_MIGRATIONS: ReadonlyMap<number, SceneMigration> = new Map();

/**
 * Upgrades a Scene IR document of any supported major to the current major, using
 * `migrations` (default: the registered steps). The result is not schema-checked: pass it
 * to `validateSceneComponent()` next. An unsupported version is `APPLY_IR_VERSION_UNSUPPORTED`.
 */
export function migrateScene(
  doc: unknown,
  migrations: ReadonlyMap<number, SceneMigration> = SCENE_MIGRATIONS,
  supported: readonly number[] = SUPPORTED_SCENE_MAJORS,
): Result<Record<string, unknown>, readonly Diagnostic[]> {
  const version = isRecord(doc) ? doc.sceneVersion : undefined;
  const unsupported = checkVersion('Scene IR', version, supported);
  if (unsupported) return err([unsupported]);
  // `checkVersion` accepted it, so `doc` is an object with a supported semver `sceneVersion`.
  let migrated = doc as Record<string, unknown>;
  const current = Math.max(...supported);
  for (let from = parseMajor(version as string) as number; from < current; from++) {
    const step = migrations.get(from);
    if (!step) throw new Error(`Missing Scene IR migration ${from} → ${from + 1}.`);
    migrated = step(migrated);
  }
  return ok(migrated);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
