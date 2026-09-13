import type { GeneratedFile } from "@shared/schemas";
import { HttpError } from "../lib/http";

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

async function gh<T = Json>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "PromptShip",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (Json & { message?: string; errors?: { message?: string }[] }) | null;
  if (!res.ok) {
    const detail = data?.errors?.[0]?.message;
    throw new GitHubError(res.status, detail ?? data?.message ?? `GitHub request failed (${res.status})`);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exchanges an OAuth code for a token, then looks up the account's login. */
export async function exchangeCode(opts: { clientId: string; clientSecret: string; code: string; redirectUri: string }) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "PromptShip" },
    body: JSON.stringify({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!res.ok || !data?.access_token) {
    throw new HttpError(400, "github_oauth_failed", data?.error_description ?? "GitHub sign-in failed");
  }
  const user = await gh<{ login: string }>(data.access_token, "GET", "/user");
  return { token: data.access_token, login: user.login };
}

/**
 * Creates a public repo and pushes every file in ONE commit through the Git Data API
 * (tree with inline contents -> commit -> move the branch ref), instead of one commit per file.
 */
export async function pushToGitHub(
  token: string,
  opts: { repoName: string; description: string; files: GeneratedFile[]; message: string },
): Promise<{ url: string; fullName: string }> {
  let repo: { name: string; html_url: string; full_name: string; default_branch?: string; owner: { login: string } };
  try {
    repo = await gh(token, "POST", "/user/repos", {
      name: opts.repoName,
      description: opts.description.slice(0, 350),
      private: false,
      auto_init: true, // gives us a first commit and branch to build on
    });
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422) {
      throw new HttpError(409, "repo_exists", `You already have a repository named "${opts.repoName}". Pick another name.`);
    }
    throw err;
  }

  const base = `/repos/${repo.owner.login}/${repo.name}`;
  const branch = repo.default_branch ?? "main";

  // The auto_init commit can take a moment to appear.
  let head: { object: { sha: string } } | null = null;
  for (let attempt = 0; attempt < 6 && !head; attempt++) {
    try {
      head = await gh(token, "GET", `${base}/git/ref/heads/${branch}`);
    } catch (err) {
      if (!(err instanceof GitHubError) || (err.status !== 404 && err.status !== 409)) throw err;
      await sleep(400 * (attempt + 1));
    }
  }
  if (!head) throw new GitHubError(504, "GitHub didn't finish creating the repository. Try again.");

  const parent = await gh<{ tree: { sha: string } }>(token, "GET", `${base}/git/commits/${head.object.sha}`);
  const tree = await gh<{ sha: string }>(token, "POST", `${base}/git/trees`, {
    base_tree: parent.tree.sha,
    tree: opts.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
  });
  const commit = await gh<{ sha: string }>(token, "POST", `${base}/git/commits`, {
    message: opts.message,
    tree: tree.sha,
    parents: [head.object.sha],
  });
  await gh(token, "PATCH", `${base}/git/refs/heads/${branch}`, { sha: commit.sha });

  return { url: repo.html_url, fullName: repo.full_name };
}
