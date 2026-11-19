import source from 'virtual:holotype-serializer';

/**
 * The in-page serializer (`src/page/**`) as one IIFE string, for `page.addInitScript`.
 * The storybook-addon reuses the same string (D-08).
 */
export const serializerSource: string = source;
