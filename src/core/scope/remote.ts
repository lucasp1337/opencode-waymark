import { err, ok, type Result } from "../model/result";
import { isSafeScopeId } from "../model/scope";

export interface RemoteIdentity {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

// scheme://[user[:password]@]host[:port]/path
const URL_FORM = /^(?:https?|ssh|git|git\+ssh):\/\/(?:[^@/]*@)?([^/:@]+)(?::\d+)?\/(.+)$/i;
// [user@]host:path; a one-character host is a drive letter (C:foo/bar), not a host.
const SCP_FORM = /^(?:[^@/:]+@)?([^/:@]{2,}):(.+)$/;

// The message never echoes the remote: it may carry credentials and ends up in logs.
const UNSUPPORTED = "remote is not a host/owner/name repository address";

export function repoIdOf(identity: RemoteIdentity): string {
  return `${identity.host}/${identity.owner}/${identity.name}`;
}

export function orgIdOf(identity: RemoteIdentity): string {
  return `${identity.host}/${identity.owner}`;
}

function splitHostAndPath(url: string): { host: string; path: string } | undefined {
  const [, host, path] = URL_FORM.exec(url) ?? SCP_FORM.exec(url) ?? [];
  return host === undefined || path === undefined ? undefined : { host, path };
}

// Hosts treat owner and name case-insensitively, so one repository must map to one scope.
export function parseRemote(url: string): Result<RemoteIdentity, string> {
  const parts = splitHostAndPath(url);
  if (parts === undefined) {
    return err(UNSUPPORTED);
  }
  const path = parts.path
    .toLowerCase()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 1) {
    return err(UNSUPPORTED);
  }
  const identity = {
    host: parts.host.toLowerCase(),
    owner: path.slice(0, lastSlash),
    name: path.slice(lastSlash + 1),
  };
  return isSafeScopeId(repoIdOf(identity)) ? ok(identity) : err(UNSUPPORTED);
}
