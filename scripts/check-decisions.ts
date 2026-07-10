import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const adrDirectory = join(root, "docs/adr");
const index = readFileSync(join(adrDirectory, "README.md"), "utf8");
const errors = [];
const records = new Map();

const effectiveStart = index.indexOf("## Effective decisions");
const supersededStart = index.indexOf("## Superseded decisions");
const writingStart = index.indexOf("## Writing an ADR");

if (effectiveStart === -1 || supersededStart === -1 || writingStart === -1) {
  errors.push("docs/adr/README.md: missing lifecycle index sections");
}

const effectiveIndex = index.slice(effectiveStart, supersededStart);
const supersededIndex = index.slice(supersededStart, writingStart);

const adrFiles = readdirSync(adrDirectory)
  .filter((file) => /^\d{4}-[a-z0-9-]+\.md$/.test(file))
  .sort();

if (adrFiles.length === 0) {
  errors.push("at least one accepted ADR is required");
}

for (const [position, file] of adrFiles.entries()) {
  const expectedNumber = String(position + 1).padStart(4, "0");
  const actualNumber = file.slice(0, 4);
  const content = readFileSync(join(adrDirectory, file), "utf8");

  if (actualNumber !== expectedNumber) {
    errors.push(`${file}: expected sequential ADR number ${expectedNumber}`);
  }

  if (!content.startsWith(`# ADR ${actualNumber}: `)) {
    errors.push(`${file}: title must start with "# ADR ${actualNumber}: "`);
  }

  const status = content.match(/^- Status: (Accepted|Superseded)$/m)?.[1];
  if (!status) {
    errors.push(`${file}: status must be Accepted or Superseded`);
  }

  const requiredMetadata = ["- Date: ", "- Owners: ", "- Related specifications: "];

  for (const metadata of requiredMetadata) {
    if (!content.includes(metadata)) {
      errors.push(`${file}: missing metadata ${metadata.trim()}`);
    }
  }

  const requiredSections = [
    "## Context",
    "## Decision drivers",
    "## Decision",
    "## Alternatives considered",
    "## Consequences",
    "## Validation",
  ];

  for (const section of requiredSections) {
    if (!content.includes(section)) {
      errors.push(`${file}: missing section ${section}`);
    }
  }

  if (status === "Accepted") {
    if (!content.match(/^- Supersedes: (None|ADR \d{4}(?:, ADR \d{4})*)$/m)) {
      errors.push(`${file}: accepted ADR must declare Supersedes metadata`);
    }
    if (!effectiveIndex.includes(`(${file})`)) {
      errors.push(`${file}: missing from effective decisions index`);
    }
    if (supersededIndex.includes(`(${file})`)) {
      errors.push(`${file}: accepted ADR appears in superseded decisions index`);
    }
  }

  if (status === "Superseded") {
    if (!content.match(/^- Superseded by: ADR \d{4}$/m)) {
      errors.push(`${file}: superseded ADR must name its replacement`);
    }
    if (!supersededIndex.includes(`(${file})`)) {
      errors.push(`${file}: missing from superseded decisions index`);
    }
    if (effectiveIndex.includes(`(${file})`)) {
      errors.push(`${file}: superseded ADR appears in effective decisions index`);
    }
  }

  records.set(actualNumber, { content, file, status });
}

const indexedAdrs = [...index.matchAll(/\((\d{4}-[a-z0-9-]+\.md)\)/g)].map(
  (match) => match[1],
);

for (const file of indexedAdrs) {
  if (!adrFiles.includes(file)) {
    errors.push(`docs/adr/README.md: references missing ADR ${file}`);
  }
}

for (const [number, record] of records) {
  if (record.status === "Accepted") {
    const supersedes = record.content.match(/^- Supersedes: (.+)$/m)?.[1];
    if (supersedes && supersedes !== "None") {
      for (const reference of supersedes.matchAll(/ADR (\d{4})/g)) {
        const prior = records.get(reference[1]);
        if (!prior) {
          errors.push(`${record.file}: supersedes missing ADR ${reference[1]}`);
        } else if (prior.status !== "Superseded") {
          errors.push(`${record.file}: ADR ${reference[1]} is not marked Superseded`);
        } else if (!prior.content.includes(`- Superseded by: ADR ${number}`)) {
          errors.push(`${record.file}: ADR ${reference[1]} does not link back to ADR ${number}`);
        }
      }
    }
  }

  if (record.status === "Superseded") {
    const replacementNumber = record.content.match(/^- Superseded by: ADR (\d{4})$/m)?.[1];
    const replacement = replacementNumber ? records.get(replacementNumber) : undefined;
    if (replacementNumber && !replacement) {
      errors.push(`${record.file}: replacement ADR ${replacementNumber} does not exist`);
    } else if (replacement && replacement.status !== "Accepted") {
      errors.push(`${record.file}: replacement ADR ${replacementNumber} is not effective`);
    } else if (
      replacement &&
      !replacement.content.match(new RegExp(`^- Supersedes: .*ADR ${number}(?:,|$)`, "m"))
    ) {
      errors.push(
        `${record.file}: replacement ADR ${replacementNumber} does not declare ADR ${number}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const acceptedCount = [...records.values()].filter((record) => record.status === "Accepted").length;
const supersededCount = [...records.values()].filter(
  (record) => record.status === "Superseded",
).length;
console.log(
  `decision check passed (${acceptedCount} effective, ${supersededCount} superseded ADRs)`,
);
