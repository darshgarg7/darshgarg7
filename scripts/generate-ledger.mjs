#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_COMMITS = 12;
const MESSAGE_LIMIT = 58;
const PALETTE = ["#38bdf8", "#22d3ee", "#2dd4bf", "#a3e635", "#fbbf24", "#c084fc"];

export function escapeXML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function truncate(value, limit = MESSAGE_LIMIT) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

export function extractRecentCommits(events, limit = MAX_COMMITS) {
  if (!Array.isArray(events)) return [];

  const commits = [];
  const seen = new Set();

  for (const event of events) {
    if (event?.type !== "PushEvent" || !Array.isArray(event?.payload?.commits)) continue;

    const repo = String(event?.repo?.name || "unknown/repository").split("/").at(-1);
    for (const commit of event.payload.commits) {
      const sha = String(commit?.sha || "").slice(0, 7);
      if (!sha) continue;

      const key = `${repo}:${sha}`;
      if (seen.has(key)) continue;
      seen.add(key);

      commits.push({
        repo,
        sha,
        message: truncate(String(commit?.message || "Untitled commit").split("\n")[0]),
        timestamp: event.created_at || null,
      });

      if (commits.length >= limit) return commits;
    }
  }

  return commits;
}

export function extractPushHeads(events, limit = MAX_COMMITS) {
  if (!Array.isArray(events)) return [];

  const heads = [];
  const seen = new Set();

  for (const event of events) {
    const fullRepo = String(event?.repo?.name || "");
    const head = String(event?.payload?.head || "");
    if (event?.type !== "PushEvent" || !fullRepo.includes("/") || !head) continue;

    const key = `${fullRepo}:${head}`;
    if (seen.has(key)) continue;
    seen.add(key);
    heads.push({ fullRepo, head, timestamp: event.created_at || null });
    if (heads.length >= limit) break;
  }

  return heads;
}

export async function fetchRecentCommits(
  username,
  { token = process.env.GITHUB_TOKEN, fetchImpl = globalThis.fetch } = {},
) {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) {
    throw new Error("Invalid GitHub username");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("This generator requires Node.js 20 or newer");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "darshgarg7-profile-ledger",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(
    `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );

  if (!response.ok) {
    throw new Error(`GitHub API responded with ${response.status}`);
  }

  const events = await response.json();
  const embeddedCommits = extractRecentCommits(events);
  if (embeddedCommits.length > 0) return embeddedCommits;

  // GitHub's public Events API may omit payload.commits and expose only the
  // push head. Resolve each public head through the repository commit API.
  const heads = extractPushHeads(events);
  const resolved = await Promise.allSettled(
    heads.map(async ({ fullRepo, head, timestamp }) => {
      const commitResponse = await fetchImpl(
        `https://api.github.com/repos/${fullRepo}/commits/${encodeURIComponent(head)}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (!commitResponse.ok) throw new Error(`Could not resolve ${fullRepo}@${head.slice(0, 7)}`);

      const commit = await commitResponse.json();
      return {
        repo: fullRepo.split("/").at(-1),
        sha: String(commit?.sha || head).slice(0, 7),
        message: truncate(String(commit?.commit?.message || "Public push").split("\n")[0]),
        timestamp: commit?.commit?.author?.date || timestamp,
      };
    }),
  );

  return resolved.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const fallback = heads[index];
    return {
      repo: fallback.fullRepo.split("/").at(-1),
      sha: fallback.head.slice(0, 7),
      message: "Public push (commit metadata unavailable)",
      timestamp: fallback.timestamp,
    };
  });
}

export function colorFor(value) {
  let hash = 0;
  for (const character of String(value)) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function renderSVG({
  commits,
  username,
  generatedAt = new Date(),
  status = commits.length > 0 ? "live" : "empty",
}) {
  const width = 1000;
  const height = 250;
  const laneY = 124;
  const startX = 60;
  const endX = 940;
  const gateX = [135, 500, 865];
  const gateLabels = ["PROPOSED", "POLICY CHECK", "VERIFIED"];
  const cycleSeconds = Math.max(16, commits.length * 1.2 + 9);

  const tokens = commits
    .map((commit, index) => {
      const color = colorFor(commit.repo);
      const begin = (index * 1.2).toFixed(1);
      const label = escapeXML(`${commit.repo} · ${commit.sha} · ${commit.message}`);

      return `
    <circle r="7" fill="${color}" opacity="0">
      <title>${label}</title>
      <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.02;0.56;0.62;1" dur="${cycleSeconds}s" begin="${begin}s" repeatCount="indefinite"/>
      <animate attributeName="fill" values="${color};${color};#a3e635;#a3e635" keyTimes="0;0.27;0.34;1" dur="${cycleSeconds}s" begin="${begin}s" repeatCount="indefinite"/>
      <animate attributeName="r" values="7;7;10;7" keyTimes="0;0.27;0.33;1" dur="${cycleSeconds}s" begin="${begin}s" repeatCount="indefinite"/>
      <animateMotion path="M ${startX} ${laneY} L ${endX} ${laneY}" keyPoints="0;1;1" keyTimes="0;0.6;1" dur="${cycleSeconds}s" begin="${begin}s" repeatCount="indefinite"/>
    </circle>`;
    })
    .join("");

  const gates = gateX
    .map(
      (x, index) => `
    <g transform="translate(${x} ${laneY})">
      <line x1="0" y1="-36" x2="0" y2="36" stroke="#475569" stroke-width="1.5" stroke-dasharray="3 5"/>
      <circle r="5" fill="${index === 1 ? "#2dd4bf" : "#64748b"}"/>
      <text x="0" y="-49" text-anchor="middle" class="gate">${gateLabels[index]}</text>
    </g>`,
    )
    .join("");

  const emptyMessages = {
    empty: "No recent public push activity was returned by GitHub.",
    offline: "Offline verification mode — network activity was intentionally skipped.",
    unavailable: "Public activity was temporarily unavailable at the last refresh.",
  };

  const activityLayer =
    commits.length > 0
      ? tokens
      : `<g>
    <circle cx="${startX}" cy="${laneY}" r="6" fill="#64748b"/>
    <text x="500" y="176" text-anchor="middle" class="empty">${escapeXML(emptyMessages[status] || emptyMessages.empty)}</text>
  </g>`;

  const latest = commits[0];
  const latestLine = latest
    ? `<text x="60" y="207" class="latest-label">LATEST PUBLIC PUSH</text>
  <text x="60" y="228" class="latest">
    <tspan fill="${colorFor(latest.repo)}">${escapeXML(latest.repo)}</tspan>
    <tspan fill="#64748b"> · ${escapeXML(latest.sha)} · </tspan>
    <tspan fill="#cbd5e1">${escapeXML(truncate(latest.message, 82))}</tspan>
  </text>`
    : "";

  const refreshed = generatedAt.toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, " UTC");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXML(username)} public commit authorization ledger</title>
  <desc id="desc">Recent public commits flow through proposed, policy check, and verified stages. This is a visualization of public GitHub activity, not an authorization claim about the commits.</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111f"/>
      <stop offset="1" stop-color="#111d31"/>
    </linearGradient>
    <linearGradient id="lane" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.28"/>
      <stop offset="0.5" stop-color="#2dd4bf" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#a3e635" stop-opacity="0.34"/>
    </linearGradient>
    <style>
      .title { font: 700 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #e2e8f0; letter-spacing: 0.7px; }
      .meta { font: 500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #64748b; }
      .gate { font: 650 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #94a3b8; letter-spacing: 1.5px; }
      .empty { font: 500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #64748b; }
      .latest-label { font: 650 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; fill: #64748b; letter-spacing: 1.2px; }
      .latest { font: 500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" rx="16" fill="url(#background)"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="15" fill="none" stroke="#334155" stroke-opacity="0.8"/>
  <text x="60" y="36" class="title">AUTHORIZATION LEDGER <tspan fill="#475569">/ PUBLIC COMMIT ACTIVITY</tspan></text>
  <text x="940" y="36" text-anchor="end" class="meta">REFRESHED ${escapeXML(refreshed)}</text>
  <line x1="${startX}" y1="${laneY}" x2="${endX}" y2="${laneY}" stroke="url(#lane)" stroke-width="2"/>
  ${gates}
  ${activityLayer}
  ${latestLine}
</svg>`;
}

export async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const username = args.find((argument) => !argument.startsWith("--")) || process.env.GH_USERNAME || "darshgarg7";
  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/authorization-ledger.svg");

  let commits = [];
  let status = offline ? "offline" : "empty";

  if (!offline) {
    try {
      commits = await fetchRecentCommits(username);
      status = commits.length > 0 ? "live" : "empty";
    } catch (error) {
      status = "unavailable";
      console.warn(`Could not read public GitHub activity: ${error.message}`);
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    renderSVG({ commits, username, status, generatedAt: new Date() }),
    "utf8",
  );
  console.log(`Wrote ${outputPath} (${commits.length} public commits; status=${status})`);
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) await main();
