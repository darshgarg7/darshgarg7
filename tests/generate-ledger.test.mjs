import test from "node:test";
import assert from "node:assert/strict";

import {
  escapeXML,
  extractPushHeads,
  extractRecentCommits,
  fetchRecentCommits,
  renderSVG,
  truncate,
} from "../scripts/generate-ledger.mjs";

const events = [
  {
    type: "PushEvent",
    created_at: "2026-08-02T12:00:00Z",
    repo: { name: "darshgarg7/Bouncer" },
    payload: {
      commits: [
        { sha: "abcdef123456", message: "verify <unsafe> & bounded state\n\nDetails" },
        { sha: "123456789abc", message: "add a release gate" },
      ],
    },
  },
  {
    type: "IssuesEvent",
    repo: { name: "darshgarg7/ignored" },
    payload: {},
  },
];

test("extractRecentCommits keeps real push data in event order", () => {
  assert.deepEqual(extractRecentCommits(events), [
    {
      repo: "Bouncer",
      sha: "abcdef1",
      message: "verify <unsafe> & bounded state",
      timestamp: "2026-08-02T12:00:00Z",
    },
    {
      repo: "Bouncer",
      sha: "1234567",
      message: "add a release gate",
      timestamp: "2026-08-02T12:00:00Z",
    },
  ]);
});

test("extractRecentCommits deduplicates commits and respects its limit", () => {
  const duplicated = [events[0], events[0]];
  assert.equal(extractRecentCommits(duplicated, 1).length, 1);
});

test("extractPushHeads supports the compact public Events API payload", () => {
  const compactEvents = [
    {
      type: "PushEvent",
      created_at: "2026-08-02T12:00:00Z",
      repo: { name: "darshgarg7/Tortus" },
      payload: { head: "fedcba987654321" },
    },
    {
      type: "PushEvent",
      created_at: "2026-08-02T12:00:00Z",
      repo: { name: "darshgarg7/Tortus" },
      payload: { head: "fedcba987654321" },
    },
  ];

  assert.deepEqual(extractPushHeads(compactEvents), [
    {
      fullRepo: "darshgarg7/Tortus",
      head: "fedcba987654321",
      timestamp: "2026-08-02T12:00:00Z",
    },
  ]);
});

test("XML escaping and truncation handle untrusted public event text", () => {
  assert.equal(escapeXML(`<tag a="b">Tom & Jerry's</tag>`), "&lt;tag a=&quot;b&quot;&gt;Tom &amp; Jerry&apos;s&lt;/tag&gt;");
  assert.equal(truncate("  a   sentence   with spaces  "), "a sentence with spaces");
  assert.equal(truncate("abcdefghij", 6), "abcde…");
});

test("renderSVG emits accessible, escaped, evidence-qualified output", () => {
  const svg = renderSVG({
    commits: extractRecentCommits(events),
    username: "darshgarg7",
    generatedAt: new Date("2026-08-02T12:34:56Z"),
    status: "live",
  });

  assert.match(svg, /aria-labelledby="title desc"/);
  assert.match(svg, /verify &lt;unsafe&gt; &amp; bounded state/);
  assert.match(svg, /This is a visualization of public GitHub activity/);
  assert.match(svg, /REFRESHED 2026-08-02 12:34 UTC/);
  assert.doesNotMatch(svg, /<unsafe>/);
});

test("renderSVG tells the truth when no public activity is available", () => {
  const svg = renderSVG({
    commits: [],
    username: "darshgarg7",
    generatedAt: new Date("2026-08-02T12:34:56Z"),
    status: "unavailable",
  });

  assert.match(svg, /temporarily unavailable/);
  assert.doesNotMatch(svg, /Untitled commit/);
});

test("fetchRecentCommits validates the username and supports a test fetch", async () => {
  await assert.rejects(() => fetchRecentCommits("not/a/user"), /Invalid GitHub username/);

  const commits = await fetchRecentCommits("darshgarg7", {
    token: "test-token",
    fetchImpl: async (url, options) => {
      assert.match(url, /users\/darshgarg7\/events\/public/);
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return { ok: true, json: async () => events };
    },
  });

  assert.equal(commits.length, 2);
});
