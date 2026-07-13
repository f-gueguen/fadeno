#!/usr/bin/env node

import { runProjectCheckCommand } from "./internal/project-check.ts";
import { runProjectBuildCommand } from "./internal/project-build.ts";
import { runProjectDevCommand } from "./internal/project-dev.ts";

const arguments_ = process.argv.slice(2);
const context = { cwd: process.cwd() };
const result = arguments_[0] === "build"
  ? await runProjectBuildCommand(arguments_, context)
  : arguments_[0] === "dev"
    ? await runProjectDevCommand(arguments_, {
      ...context,
      writeStdout: (value) => process.stdout.write(value),
      writeStderr: (value) => process.stderr.write(value),
    })
    : await runProjectCheckCommand(arguments_, context);
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
