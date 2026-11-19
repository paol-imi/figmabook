import { run } from '@holotype/cli';
import { parseInputs } from './inputs';

const inputs = parseInputs(process.env);
process.chdir(inputs.workingDirectory);
process.exitCode = await run({ command: inputs.command, args: inputs.args });
