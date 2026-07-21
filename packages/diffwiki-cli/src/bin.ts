import { createProgram } from './cli';

// Commander reads and slices process.argv itself, and handles --help/--version.
createProgram().parseAsync(process.argv);
