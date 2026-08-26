#!/usr/bin/env node

import { runProjectCheckCommand } from "./internal/project-check.ts";
import { runProjectBuildCommand } from "./internal/project-build.ts";
import { runProjectCreateCommand } from "./internal/project-create.ts";
import { runProjectDeployCommand } from "./internal/project-deploy.ts";
import { runProjectDevCommand } from "./internal/project-dev.ts";

const arguments_ = process.argv.slice(2);
const context = { cwd: process.cwd() };
const command = arguments_[0];
const commands = {
  check: () => runProjectCheckCommand(arguments_, context),
  build: () => runProjectBuildCommand(arguments_, context),
  create: () => runProjectCreateCommand(arguments_, context),
  deploy: () => runProjectDeployCommand(arguments_, context),
  dev: () => runProjectDevCommand(arguments_, {
      ...context,
      writeStdout: (value) => process.stdout.write(value),
      writeStderr: (value) => process.stderr.write(value),
  }),
};
const run = command === undefined
  ? commands.check
  : Object.hasOwn(commands, command) ? commands[command as keyof typeof commands] : undefined;
const result = run
  ? await run()
  : { exitCode: 2, stdout: "", stderr: `FADENO_CLI_COMMAND: unknown command ${JSON.stringify(command)}\nUsage: fadeno <${Object.keys(commands).join("|")}>\n` };
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
