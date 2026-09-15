import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { handleRequest } from "../src/worker.js";

const API_KEY = "test-only-shared-key";
const ENV = {
  PONTY_API_KEY: API_KEY,
  GITHUB_WORKFLOW_TOKEN: "test-only-github-token",
  GITHUB_OWNER: "jennieferberg-prio",
  GITHUB_REPO: "priorekrytering",
  GITHUB_WORKFLOW: "ponty-sync.yml",
  GITHUB_REF: "main",
  SITE_BASE_URL: "https://priorekrytering.se"
};

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iat: now, exp: now + 60 })}`;
  const signature = createHmac("sha256", API_KEY).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function pontyHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "X-PNTY-AUTH-2": `Bearer ${jwt()}`,
    ...extra
  };
}

test("reports custom Ponty protocol version", async () => {
  const response = await handleRequest(new Request("https://worker.example/pnty_version"), ENV);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { version: "1.0.13.c" });
});

test("does not expose the WordPress inventory endpoint", async () => {
  const response = await handleRequest(new Request("https://worker.example/pnty_ads"), ENV);
  assert.equal(response.status, 404);
});

test("validates a push and dispatches the GitHub workflow", async () => {
  let dispatch;
  const fetchImpl = async (url, options) => {
    dispatch = { url, options, body: JSON.parse(options.body) };
    return new Response(null, { status: 204 });
  };
  const request = new Request("https://worker.example/pnty_jobs_api", {
    method: "POST",
    headers: pontyHeaders(),
    body: JSON.stringify({ assignment_id: 3, slug: "serviceelektriker", system_slug: "priorekrytering" })
  });

  const response = await handleRequest(request, ENV, fetchImpl);
  assert.deepEqual(await response.json(), {
    success: true,
    message: "",
    url: "https://priorekrytering.se/lediga-jobb/serviceelektriker-3/"
  });
  assert.equal(dispatch.url, "https://api.github.com/repos/jennieferberg-prio/priorekrytering/actions/workflows/ponty-sync.yml/dispatches");
  assert.equal(dispatch.options.headers.Authorization, "Bearer test-only-github-token");
  assert.deepEqual(dispatch.body, {
    ref: "main"
  });
});

test("dispatches an authenticated delete", async () => {
  let body;
  const fetchImpl = async (_url, options) => {
    body = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  };
  const request = new Request("https://worker.example/pnty_jobs_api/3", {
    method: "DELETE",
    headers: pontyHeaders({ "X-PNTY-SLUG": "priorekrytering" })
  });

  const response = await handleRequest(request, ENV, fetchImpl);
  assert.deepEqual(await response.json(), { success: true, message: "", post: "3" });
  assert.deepEqual(body, { ref: "main" });
});

test("returns Ponty's legacy HTTP 200 error shape for bad authentication", async () => {
  let dispatched = false;
  const request = new Request("https://worker.example/pnty_jobs_api", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-PNTY-AUTH-2": "Bearer invalid" },
    body: JSON.stringify({ assignment_id: 3 })
  });
  const response = await handleRequest(request, ENV, async () => {
    dispatched = true;
    return new Response(null, { status: 204 });
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: false, message: "Not authenticated. Please check API keys." });
  assert.equal(dispatched, false);
});

test("reports a dispatch failure to Ponty without exposing GitHub details", async () => {
  const request = new Request("https://worker.example/pnty_jobs_api", {
    method: "POST",
    headers: pontyHeaders(),
    body: JSON.stringify({ assignment_id: 3, slug: "serviceelektriker" })
  });
  const response = await handleRequest(request, ENV, async () => new Response("API details", { status: 503 }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: false, message: "Could not start the job synchronization." });
});
