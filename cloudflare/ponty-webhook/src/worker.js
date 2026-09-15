const PROTOCOL_VERSION = "1.0.13.c";
const MAX_TOKEN_AGE_SECONDS = 60;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function protocolFailure(message) {
  return jsonResponse({ success: false, message });
}

function base64UrlBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

async function authenticatePonty(request, apiKey) {
  if (!apiKey) throw new Error("Worker is missing PONTY_API_KEY.");
  const authorization = request.headers.get("X-PNTY-AUTH-2") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return false;

  const parts = match[1].split(".");
  if (parts.length !== 3) return false;

  try {
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    if (header.alg !== "HS256") return false;
    if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > MAX_TOKEN_AGE_SECONDS || now > payload.exp) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(apiKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch (_error) {
    return false;
  }
}

function cleanAssignmentId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : "";
}

function slugify(value) {
  return String(value || "jobb")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "jobb";
}

async function dispatchSync(env, fetchImpl) {
  const required = ["GITHUB_WORKFLOW_TOKEN", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_WORKFLOW", "GITHUB_REF"];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Worker is missing ${missing.join(", ")}.`);

  const endpoint = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_WORKFLOW_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "prio-ponty-webhook",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ ref: env.GITHUB_REF })
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    console.error(JSON.stringify({ event: "github_dispatch_failed", status: response.status, details }));
    throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}.`);
  }
}

async function handlePost(request, env, fetchImpl) {
  let ad;
  try {
    ad = await request.json();
  } catch (_error) {
    return protocolFailure("Could not understand the request body.");
  }
  const assignmentId = cleanAssignmentId(ad?.assignment_id);
  if (!assignmentId) return protocolFailure("An assignment id is required.");
  await dispatchSync(env, fetchImpl);

  const baseUrl = String(env.SITE_BASE_URL || "https://priorekrytering.se").replace(/\/$/, "");
  const slug = slugify(ad?.slug || ad?.title);
  return jsonResponse({
    success: true,
    message: "",
    url: `${baseUrl}/lediga-jobb/${slug}-${encodeURIComponent(assignmentId)}/`
  });
}

async function handleDelete(request, env, assignmentId, fetchImpl) {
  const systemSlug = String(request.headers.get("X-PNTY-SLUG") || "").trim();
  if (!systemSlug) return protocolFailure("A system slug is required.");

  await dispatchSync(env, fetchImpl);

  return jsonResponse({ success: true, message: "", post: assignmentId });
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "GET" && path === "/pnty_version") {
    return jsonResponse({ version: PROTOCOL_VERSION });
  }

  const deleteMatch = request.method === "DELETE" && path.match(/^\/pnty_jobs_api\/([A-Za-z0-9_-]+)$/);
  const isPost = request.method === "POST" && path === "/pnty_jobs_api";
  if (!isPost && !deleteMatch) return jsonResponse({ error: "Not found" }, 404);

  try {
    if (!await authenticatePonty(request, env.PONTY_API_KEY)) {
      return protocolFailure("Not authenticated. Please check API keys.");
    }
    if (isPost) return await handlePost(request, env, fetchImpl);
    return await handleDelete(request, env, deleteMatch[1], fetchImpl);
  } catch (error) {
    console.error(JSON.stringify({ event: "ponty_push_failed", message: error.message }));
    return protocolFailure("Could not start the job synchronization.");
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
