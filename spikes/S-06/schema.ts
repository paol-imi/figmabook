/** S-06 step 1 answers (BUILD B-25). Test-only. */
import { Type } from '@sinclair/typebox';
import { Nullable } from '../_shared/schema.ts';

const Sizes = Type.Object({ string: Type.Integer({ minimum: 0 }), bytes: Type.Integer({ minimum: 0 }) });

/** Best unzip path that worked in the UI iframe (see `ZipPath` in `iframe.ts`). */
const ZipPath = Type.Union([
  Type.Literal('async-worker'),
  Type.Literal('async-inline'),
  Type.Literal('sync'),
  Type.Literal('none'),
]);

export const S06Answers = {
  step1: Type.Object(
    {
      setTimeoutInMain: Type.Boolean(),
      cryptoSubtleInMain: Type.Boolean(),
      cryptoSubtleDigestInMain: Type.Boolean(),
      newFunctionInMain: Type.Boolean(),
      evalInMain: Type.Boolean(),
      typeboxCompiledCheckInMain: Type.Boolean(),
      structuredCloneInMain: Type.Boolean(),
      textEncoderInMain: Type.Boolean(),
      textDecoderInMain: Type.Boolean(),
      newFunctionInUi: Type.Boolean(),
      evalInUi: Type.Boolean(),
      typeboxCompiledCheckInUi: Type.Boolean(),
      cryptoSubtleInUi: Type.Boolean(),
      cryptoSubtleDigestInUi: Type.Boolean(),
      getRandomValuesInUi: Type.Boolean(),
      randomUUIDInUi: Type.Boolean(),
      secureContextInUi: Nullable(Type.Boolean()),
      originInUi: Nullable(Type.String()),
      blobWorkerInUi: Type.Boolean(),
      fflateUnzipPathInUi: ZipPath,
      postMessageMaxOkBytes: Type.Object({ uiToMain: Sizes, mainToUi: Sizes, largestTried: Type.Integer() }),
      fileKeyReadable: Type.Boolean(),
      blobDownloadFromUi: Type.Union([Type.Literal('yes'), Type.Literal('no'), Type.Literal('unsure')]),
    },
    { additionalProperties: false },
  ),
};
