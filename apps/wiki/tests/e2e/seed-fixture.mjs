// apps/wiki/tests/e2e/seed-fixture.mjs
//
// Shared, idempotent seeder for the e2e fixture home. Both Playwright's
// globalSetup AND the static-export webServer (`serve:static-e2e`) call this so
// the exported bundle never depends on globalSetup having run first — Playwright
// starts webServer processes BEFORE globalSetup, so the static export must seed
// its own registry or it exports an empty wiki.
//
// Idempotent by design: it (re)writes the same files in place and never `rm`s the
// home, so it is safe to call even while another process is reading the directory.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Seed the fixture DIFFWIKI_HOME with a registry + two collections (notes, devlog).
 * Keep this content identical to what the browser specs assert against (navigate to
 * /notes/intro, search the shared term "diffwiki", verify cross-collection filtering
 * against devlog).
 *
 * @param {string} [home] Target home dir; defaults to process.env.DIFFWIKI_HOME.
 * @returns {string} The home directory that was seeded.
 */
export function seedFixtureHome(home = process.env.DIFFWIKI_HOME) {
  if (!home) {
    throw new Error('seedFixtureHome: no home directory given and DIFFWIKI_HOME is unset');
  }

  const collectionsDir = path.join(home, 'collections');
  const notesDir = path.join(collectionsDir, 'notes');
  const guideDir = path.join(notesDir, 'guide');
  const devlogDir = path.join(collectionsDir, 'devlog');

  fs.mkdirSync(guideDir, { recursive: true });
  fs.mkdirSync(devlogDir, { recursive: true });

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

Start by [setting up](/notes/guide/setup) your first collection.

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

  // ── guide/index.md ───────────────────────────────────────────────────────────
  // A FOLDER INDEX page (served at /notes/guide). Its relative link to `setup`
  // must resolve inside the guide/ folder, so the knowledge graph shows the link
  // rather than an empty "no links on this page" neighbourhood.
  fs.writeFileSync(
    path.join(guideDir, 'index.md'),
    `---
title: Guide
---

# Guide

Start with the [setup steps](./setup).
`,
    'utf8',
  );

  // ── guide/setup.mdx ──────────────────────────────────────────────────────────
  // A nested file to verify the splat route handles subdirectories. Shares the
  // `getting-started` tag with intro (which also links here), so the knowledge
  // graph's "shared tags" mode shows a heavier intro↔setup edge (link + tag).
  fs.writeFileSync(
    path.join(guideDir, 'setup.mdx'),
    `---
title: Setting Up
tags:
  - setup
  - getting-started
---

# Setting Up

Run \`mise run dev\` to start the UI.

This nested page renders from plain **markdown**.
`,
    'utf8',
  );

  // ── devlog/release.md ─────────────────────────────────────────────────────────
  // A SECOND collection sharing the searchable term "diffwiki" with notes, so a
  // collection filter can be proven to EXCLUDE the other collection's hits (the
  // regression that leaked cross-collection results when the qmd warm path sent
  // the wrong filter key).
  fs.writeFileSync(
    path.join(devlogDir, 'release.md'),
    `---
title: diffwiki release notes
tags:
  - changelog
  - overview
---

# diffwiki release notes

The diffwiki devlog tracks each release of the knowledge base.
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
      {
        name: 'devlog',
        type: 'global',
        path: devlogDir,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  fs.writeFileSync(path.join(home, 'registry.json'), JSON.stringify(registry, null, 2), 'utf8');

  // ── config.json ───────────────────────────────────────────────────────────────
  // Optional; needed if any code path reads defaultCollection.
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ defaultCollection: 'notes' }, null, 2), 'utf8');

  return home;
}

// When invoked directly (`node tests/e2e/seed-fixture.mjs`), seed DIFFWIKI_HOME.
if (import.meta.url === `file://${process.argv[1]}`) {
  const home = process.env.DIFFWIKI_HOME;
  if (!home) {
    console.error('seed-fixture: DIFFWIKI_HOME must be set');
    process.exit(1);
  }
  seedFixtureHome(home);
}
