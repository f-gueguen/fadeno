#!/usr/bin/env node

import { runProjectCheckCommand } from "./internal/project-check.ts";
import { runProjectBuildCommand } from "./internal/project-build.ts";

const arguments_ = process.argv.slice(2);
const context = { cwd: process.cwd() };
const result = arguments_[0] === "build"
  ? await runProjectBuildCommand(arguments_, context)
  : await runProjectCheckCommand(arguments_, context);
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
