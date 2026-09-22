import { logger } from "./logger.js";
import type { Channel } from "@workspace/db";

export interface GitHubPushOptions {
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  path: string;
  content: string;
  message?: string;
}

export interface GitHubPushResult {
  success: boolean;
  commitSha?: string;
  commitUrl?: string;
  fileUrl?: string;
  message?: string;
  error?: string;
}

export function generateM3UString(channels: Channel[], playlistName?: string): string {
  const lines: string[] = [];
  lines.push(`#EXTM3U name="${playlistName ?? 'StreamGuard Playlist'}"`);
  
  for (const ch of channels) {
    const attrs: string[] = [];
    if (ch.tvgId) attrs.push(`tvg-id="${ch.tvgId.replace(/"/g, "'")}"`);
    if (ch.tvgName) attrs.push(`tvg-name="${ch.tvgName.replace(/"/g, "'")}"`);
    if (ch.tvgLogo) attrs.push(`tvg-logo="${ch.tvgLogo.replace(/"/g, "'")}"`);
    if (ch.groupTitle) attrs.push(`group-title="${ch.groupTitle.replace(/"/g, "'")}"`);
    if (ch.language) attrs.push(`tvg-language="${ch.language.replace(/"/g, "'")}"`);
    if (ch.country) attrs.push(`tvg-country="${ch.country.replace(/"/g, "'")}"`);

    const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
    const title = ch.tvgName || ch.tvgId || "Channel";
    lines.push(`#EXTINF:-1${attrStr},${title}`);

    if (ch.userAgent) {
      lines.push(`#EXTVLCOPT:http-user-agent=${ch.userAgent}`);
      lines.push(`#EXTHTTP:{"User-Agent":"${ch.userAgent.replace(/"/g, '\\"')}"}`);
    }
    if (ch.referrer) {
      lines.push(`#EXTVLCOPT:http-referrer=${ch.referrer}`);
    }

    lines.push(ch.url.trim());
  }

  return lines.join("\n") + "\n";
}

export async function testGitHubConnection(token: string): Promise<{
  valid: boolean;
  username?: string;
  name?: string;
  avatarUrl?: string;
  scopes?: string;
  error?: string;
}> {
  if (!token || !token.trim()) {
    return { valid: false, error: "GitHub token is empty" };
  }

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "StreamGuard-IPTV-Engine",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return { valid: false, error: `GitHub API error (${res.status}): ${errText || res.statusText}` };
    }

    const data = (await res.json()) as { login?: string; name?: string; avatar_url?: string };
    const scopes = res.headers.get("x-oauth-scopes") || "public";

    return {
      valid: true,
      username: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      scopes,
    };
  } catch (err) {
    return { valid: false, error: `Network error reaching GitHub: ${(err as Error).message}` };
  }
}

export async function pushPlaylistToGitHub(opts: GitHubPushOptions): Promise<GitHubPushResult> {
  const { token, owner, repo, branch = "main", path: rawPath, content, message } = opts;
  if (!token || !owner || !repo || !rawPath) {
    return { success: false, error: "Token, Owner, Repo, and Path are all required" };
  }

  const cleanPath = rawPath.replace(/^\/+/, "");
  const commitMsg = message || `Update ${cleanPath} via StreamGuard [skip ci]`;
  const url = `https://api.github.com/repos/${encodeURIComponent(owner.trim())}/${encodeURIComponent(repo.trim())}/contents/${encodeURIComponent(cleanPath).replace(/%2F/g, "/")}`;

  try {
    // 1. Check if file exists to fetch sha
    let existingSha: string | undefined;
    const getRes = await fetch(`${url}?ref=${encodeURIComponent(branch.trim())}`, {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "StreamGuard-IPTV-Engine",
      },
    });

    if (getRes.ok) {
      const getJson = (await getRes.json()) as { sha?: string };
      existingSha = getJson.sha;
    }

    // 2. Put file to GitHub
    const base64Content = Buffer.from(content, "utf-8").toString("base64");
    const putRes = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "StreamGuard-IPTV-Engine",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: commitMsg,
        content: base64Content,
        branch: branch.trim(),
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      return { success: false, error: `GitHub commit rejected (${putRes.status}): ${errText}` };
    }

    const putJson = (await putRes.json()) as {
      commit?: { sha?: string; html_url?: string };
      content?: { html_url?: string };
    };

    return {
      success: true,
      commitSha: putJson.commit?.sha,
      commitUrl: putJson.commit?.html_url,
      fileUrl: putJson.content?.html_url,
      message: `Successfully pushed to ${owner}/${repo}@${branch}/${cleanPath}`,
    };
  } catch (err) {
    logger.error({ err, owner, repo, path: cleanPath }, "GitHub Push failed");
    return { success: false, error: (err as Error).message };
  }
}
