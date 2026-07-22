import { createProgram } from './cli';
import { configureCliLogging } from './logging';

// Configure LogTape sinks BEFORE parsing/actions, so startup logs (and any
// plugin diagnostics forwarded by diffwiki-core) are captured at the level
// requested via -v/--log/DIFFWIKI_LOG. The stderr sink never writes to stdout.
configureCliLogging(process.argv);

// Commander reads and slices process.argv itself, and handles --help/--version.
createProgram().parseAsync(process.argv);
