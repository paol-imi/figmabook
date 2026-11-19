/** S-06 step 1 answers (BUILD B-25). Test-only. */
import { Type } from '@sinclair/typebox';

const Sizes = Type.Object({ string: Type.Integer({ minimum: 0 }), bytes: Type.Integer({ minimum: 0 }) });

export const S06Answers = {
  step1: Type.Object(
    {
      setTimeoutInMain: Type.Boolean(),
      cryptoSubtleInMain: Type.Boolean(),
      cryptoSubtleDigestInMain: Type.Boolean(),
      postMessageMaxOkBytes: Type.Object({ uiToMain: Sizes, mainToUi: Sizes, largestTried: Type.Integer() }),
      fileKeyReadable: Type.Boolean(),
      blobDownloadFromUi: Type.Union([Type.Literal('yes'), Type.Literal('no'), Type.Literal('unsure')]),
    },
    { additionalProperties: false },
  ),
};
