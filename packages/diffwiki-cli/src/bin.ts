import { ensureHome } from 'diffwiki-core';
import { createProgram } from './cli';
import { configureCliLogging } from './logging';

// Configure LogTape sinks BEFORE parsing/actions, so startup logs (and any
// plugin diagnostics forwarded by diffwiki-core) are captured at the level
// requested via -v/--log/DIFFWIKI_LOG. The stderr sink never writes to stdout.
configureCliLogging(process.argv);

// A first-ever invocation (e.g. `npx diffwiki collection add`) must leave a fully
// initialized ~/.diffwiki behind (dirs + registry.json + config.json), so initialize
// the home before any command runs. Idempotent — never clobbers user data.
await ensureHome();

// Commander reads and slices process.argv itself, and handles --help/--version.
await createProgram().parseAsync(process.argv);
