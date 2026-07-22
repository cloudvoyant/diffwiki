// apps/wiki/tests/e2e/global-setup.ts
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fixed temp home for e2e tests. Using a fixed path (not os.tmpdir()+random) lets
 * the Playwright config's webServer.env reference the same directory deterministically
 * without coordination between global-setup and the config module.
 */
export const E2E_DIFFWIKI_HOME = '/tmp/diffwiki-e2e-home';

export default async function globalSetup(): Promise<void> {
  // Clean slate on every run.
  if (fs.existsSync(E2E_DIFFWIKI_HOME)) {
    fs.rmSync(E2E_DIFFWIKI_HOME, { recursive: true, force: true });
  }

  const collectionsDir = path.join(E2E_DIFFWIKI_HOME, 'collections');
  const notesDir = path.join(collectionsDir, 'notes');
  const guideDir = path.join(notesDir, 'guide');

  fs.mkdirSync(guideDir, { recursive: true });

  // ── intro.md ─────────────────────────────────────────────────────────────────
  // Contains: frontmatter title + tags, a TypeScript code fence, a mermaid fence.
  fs.writeFileSync(
    path.join(notesDir, 'intro.md'),
    `---
title: Introduction to diffwiki
tags:
  - overview
  - getting-started
---

# Introduction to diffwiki

Welcome to diffwiki — your local, git-friendly knowledge base.

\`\`\`ts
import { listCollections } from 'diffwiki-core';

const cols = await listCollections();
console.log(cols.map((c) => c.name));
\`\`\`

\`\`\`mermaid
flowchart LR
  A[diffwiki add] --> B[(~/.diffwiki)]
  B --> C[UI]
\`\`\`
`,
    'utf8',
  );

  // ── guide/setup.mdx ──────────────────────────────────────────────────────────
  // A nested file to verify the splat route handles subdirectories.
  fs.writeFileSync(
    path.join(guideDir, 'setup.mdx'),
    `---
title: Setting Up
tags:
  - setup
---

# Setting Up

Run \`mise run dev\` to start the UI.

This nested page renders from plain **markdown**.
`,
    'utf8',
  );

  // ── registry.json ─────────────────────────────────────────────────────────────
  // diffwiki-core's registryPath() resolves to DIFFWIKI_HOME/registry.json.
  const registry = {
    version: '1',
    collections: [
      {
        name: 'notes',
        type: 'global',
        path: notesDir,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  fs.writeFileSync(path.join(E2E_DIFFWIKI_HOME, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  // ── config.json ───────────────────────────────────────────────────────────────
  // Optional; needed if any code path reads defaultCollection.
  fs.writeFileSync(
    path.join(E2E_DIFFWIKI_HOME, 'config.json'),
    JSON.stringify({ defaultCollection: 'notes' }, null, 2),
    'utf8',
  );
}
