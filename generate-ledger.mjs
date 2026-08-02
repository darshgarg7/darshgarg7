#!/usr/bin/env node
/**
 * Generates an animated SVG that renders your recent commits as tokens
 * flowing through a three-stage authorization pipeline:
 *
 *   PROPOSED  ->  POLICY CHECK  ->  VERIFIED
 *
 * Mirrors the Bouncer lifecycle (propose -> policy -> bounded execution ->
 * verified state transition) but applied to the commit history itself.
 *
 * Usage:
 *   GITHUB_TOKEN=xxx node scripts/generate-ledger.mjs <github-username>
 *
 * Output:
 *   dist/authorization-ledger.svg
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERNAME = process.argv[2] || process.env.GH_USERNAME || "darshgarg7";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT_PATH = `${__dirname}/../dist/authorization-ledger.svg`;
const MAX_COMMITS = 12;

// ---------- 1. Fetch recent commits ----------

async function fetchRecentCommits(username) {
  const headers = { "User-Agent": "authorization-ledger-generator" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(
    `https://api.github.com/users/${username}/events/public?per_page=30`,
    { headers }
  );
  if (!res.ok) {
    throw new Error(`GitHub API responded ${res.status}`);
  }
  const events = await res.json();

  const commits = [];
  for (const event of events) {
    if (event.type !== "PushEvent") continue;
    const repo = event.repo.name.split("/")[1];
    for (const c of event.payload.commits || []) {
      commits.push({
        repo,
        message: c.message.split("\n")[0].slice(0, 46),
        sha: c.sha.slice(0, 7),
        ts: event.created_at,
      });
      if (commits.length >= MAX_COMMITS) break;
    }
    if (commits.length >= MAX_COMMITS) break;
  }
  return commits;
}

function demoCommits() {
  // Fallback so the pipeline still produces valid output with no token,
  // no recent push activity, or a rate-limited API call.
  const repos = ["Bouncer", "Recommender-Lakehouse", "Tortus", "AgenticProcurement", "CausalOps"];
  const messages = [
    "add fuzz targets for policy parity suite",
    "tighten state-delta verification bounds",
    "wire causal SASRec into ranking stage",
    "add path-recall metric to eval harness",
    "fail closed on missing lineage tag",
    "expand ellipsoidal regret test cases",
    "add tamper-evident log signing",
    "bound graph traversal depth",
  ];
  return Array.from({ length: 10 }, (_, i) => ({
    repo: repos[i % repos.length],
    message: messages[i % messages.length],
    sha: Math.random().toString(16).slice(2, 9),
    ts: new Date(Date.now() - i * 3600_000).toISOString(),
  }));
}

// ---------- 2. Render SVG ----------

const PALETTE = ["#7dd3fc", "#a3e635", "#fbbf24", "#f472b6", "#c084fc", "#5eead4"];

function colorFor(repo) {
  let h = 0;
  for (const ch of repo) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function renderSVG(commits) {
  const width = 860;
  const height = 200;
  const laneY = 92;
  const gateX = [140, 430, 720]; // PROPOSED, POLICY CHECK, VERIFIED
  const startX = 40;
  const endX = width - 40;
  const n = Math.max(commits.length, 1);
  const stagger = 1.1; // seconds between token launches
  const travelTime = 7; // seconds for a token to cross the full lane
  const loopTime = n * stagger + travelTime + 1;

  const tokens = commits
    .map((c, i) => {
      const color = colorFor(c.repo);
      const begin = (i * stagger).toFixed(2);
      const id = `tok${i}`;
      return `
    <g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.02;0.94;1"
                dur="${travelTime}s" begin="${begin}s" repeatCount="indefinite" fill="freeze"/>
      <circle id="${id}" r="6" fill="${color}">
        <animateMotion dur="${travelTime}s" begin="${begin}s" repeatCount="indefinite"
                        path="M ${startX} ${laneY} L ${endX} ${laneY}" />
        <animate attributeName="fill" values="${color};${color};#4ade80;#4ade80" 
                  keyTimes="0;0.5;0.56;1" dur="${travelTime}s" begin="${begin}s" repeatCount="indefinite"/>
        <animate attributeName="r" values="6;6;9;6" keyTimes="0;0.5;0.56;1"
                  dur="${travelTime}s" begin="${begin}s" repeatCount="indefinite"/>
        <title>${c.repo} · ${c.sha} · ${escapeXML(c.message)}</title>
      </circle>
    </g>`;
    })
    .join("");

  const gateLabels = ["PROPOSED", "POLICY CHECK", "VERIFIED"];
  const gates = gateX
    .map((x, i) => {
      const pulse = i === 1;
      return `
    <g transform="translate(${x}, ${laneY})">
      <line x1="0" y1="-34" x2="0" y2="34" stroke="#334155" stroke-width="1.5" stroke-dasharray="3 4"/>
      <circle r="4" fill="${pulse ? "#4ade80" : "#64748b"}">
        ${pulse ? `<animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite"/>` : ""}
      </circle>
      <text y="-46" text-anchor="middle" font-family="'JetBrains Mono', monospace"
            font-size="11" letter-spacing="1.5" fill="#94a3b8">${gateLabels[i]}</text>
    </g>`;
    })
    .join("");

  const ticker = commits
    .slice(0, 6)
    .map((c, i) => {
      const t = (i * 1.6).toFixed(2);
      return `
    <text x="40" y="${170}" font-family="'JetBrains Mono', monospace" font-size="11" fill="#64748b" opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.05;0.85;1" dur="1.8s" begin="${t}s" repeatCount="indefinite"/>
      <tspan fill="${colorFor(c.repo)}">${c.repo}</tspan><tspan fill="#475569"> · ${c.sha} · </tspan>${escapeXML(c.message)}
    </text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="lane" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="10" fill="#0b1220"/>
  <line x1="${startX}" y1="${laneY}" x2="${endX}" y2="${laneY}" stroke="url(#lane)" stroke-width="2"/>
  ${gates}
  ${tokens}
  ${ticker}
  <text x="40" y="30" font-family="'JetBrains Mono', monospace" font-size="12" fill="#e2e8f0" letter-spacing="0.5">
    authorization ledger <tspan fill="#475569">— live commit activity, gated</tspan>
  </text>
</svg>`;
}

function escapeXML(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- 3. Run ----------

async function main() {
  let commits;
  try {
    commits = await fetchRecentCommits(USERNAME);
    if (commits.length === 0) commits = demoCommits();
  } catch (err) {
    console.warn(`Falling back to demo data: ${err.message}`);
    commits = demoCommits();
  }

  const svg = renderSVG(commits);
  mkdirSync(`${__dirname}/../dist`, { recursive: true });
  writeFileSync(OUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUT_PATH} (${commits.length} commits)`);
}

main();
