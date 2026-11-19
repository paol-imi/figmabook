/**
 * One page per file that `pnpm diag:gen` writes to `docs/diagnostics/` (the index becomes
 * this folder's index page). The files are read at build time; restart `pnpm dev` after
 * regenerating them.
 */
import { join } from 'node:path';
import { DIAGNOSTICS_SOURCE, loadDiagnosticPages } from '../../.vitepress/lib/diagnostics.ts';
import { DESIGN_DOCS_REPO_URL, REPO_ROOT } from '../../.vitepress/lib/env.ts';

export default {
  paths() {
    return loadDiagnosticPages(join(REPO_ROOT, DIAGNOSTICS_SOURCE), DESIGN_DOCS_REPO_URL).map((page) => ({
      params: { code: page.slug },
      content: page.content,
    }));
  },
};
