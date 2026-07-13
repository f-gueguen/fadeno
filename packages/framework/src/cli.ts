#!/usr/bin/env node

import { runProjectCheckCommand } from "./internal/project-check.ts";

const result = await runProjectCheckCommand(process.argv.slice(2), { cwd: process.cwd() });
if (result.stdout !== "") process.stdout.write(result.stdout);
if (result.stderr !== "") process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
