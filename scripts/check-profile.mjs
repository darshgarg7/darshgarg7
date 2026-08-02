#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = resolve(root, "README.md");
const readme = readFileSync(readmePath, "utf8");
const failures = [];

const requiredFiles = [
  "README.md",
  "assets/hero.svg",
  "scripts/generate-ledger.mjs",
  "tests/generate-ledger.test.mjs",
  ".github/workflows/ci.yml",
  ".github/workflows/refresh-ledger.yml",
];

for (const path of requiredFiles) {
  if (!existsSync(resolve(root, path))) failures.push(`Missing required file: ${path}`);
}

const references = [];
for (const match of readme.matchAll(/(?:src|href)="([^"]+)"/g)) references.push(match[1]);
for (const match of readme.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) references.push(match[1]);

for (const reference of new Set(references)) {
  if (/^(?:https?:|mailto:|#)/.test(reference)) continue;
  const cleanPath = reference.split(/[?#]/, 1)[0];
  const localPath = resolve(root, cleanPath);
  if (!existsSync(localPath)) {
    failures.push(`README points to missing local file: ${reference}`);
  }
}

for (const match of readme.matchAll(/<img\s+[^>]*>/g)) {
  if (!/\balt="[^"]+"/.test(match[0])) failures.push(`Image needs meaningful alt text: ${match[0]}`);
}

if (readme.includes("linkedin.com/in/darsh-garg/")) {
  failures.push("README contains the stale LinkedIn profile path");
}
if (!readme.includes("linkedin.com/in/darshgarg13579/")) {
  failures.push("README is missing the canonical LinkedIn profile path");
}
if (!readme.includes("an empty feed renders an honest empty state")) {
  failures.push("README must disclose the ledger's empty-state behavior");
}
if (Buffer.byteLength(readme, "utf8") > 25_000) {
  failures.push("README is over the 25 KB profile readability budget");
}

for (const path of ["assets/hero.svg", "dist/authorization-ledger.svg"]) {
  const absolutePath = resolve(root, path);
  if (!existsSync(absolutePath)) continue;
  const svg = readFileSync(absolutePath, "utf8");
  if (extname(path) !== ".svg" || !svg.startsWith("<svg")) failures.push(`${path} is not a valid SVG document`);
  if (!/<title\b/.test(svg) || !/<desc\b/.test(svg)) failures.push(`${path} needs SVG title and description metadata`);
  if (statSync(absolutePath).size > 100_000) failures.push(`${path} is unexpectedly large`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Profile checks passed (${new Set(references).size} README references inspected)`);
}
