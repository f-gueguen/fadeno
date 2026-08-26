#!/usr/bin/env node

const arguments_ = process.argv.slice(2);
const context = { cwd: process.cwd() };
const command = arguments_[0];
const commands = {
  check: async () => (await import("./internal/project-check.ts")).runProjectCheckCommand(arguments_, context),
  build: async () => (await import("./internal/project-build.ts")).runProjectBuildCommand(arguments_, context),
  create: async () => (await import("./internal/project-create.ts")).runProjectCreateCommand(arguments_, context),
  deploy: async () => (await import("./internal/project-deploy.ts")).runProjectDeployCommand(arguments_, context),
  dev: async () => (await import("./internal/project-dev.ts")).runProjectDevCommand(arguments_, {
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
