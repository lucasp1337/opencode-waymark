# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

Only the latest 0.1.x release gets fixes.

## Scope

Waymark is local-only. It makes no network calls of its own apart from downloading the embedding model once. Memories, config, cache and log are plain files on your own disk, under `$XDG_DATA_HOME/waymark/` and `$XDG_STATE_HOME/waymark/`, readable by anyone with access to your user account. Waymark does not encrypt them.

Things worth reporting include, for example: Waymark writing outside its own directories (above all inside a repository), reading or leaking data it should not, memory text from one scope showing up in an unrelated project, or a crafted memory file or repo that makes Waymark do something harmful.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub instead:

1. Go to [Report a vulnerability](https://github.com/lucasp1337/opencode-waymark/security/advisories/new) (Security tab, "Report a vulnerability").
2. Describe the problem and include:
   - the Waymark, opencode and Bun versions, and your OS
   - steps to reproduce, or a proof of concept
   - what an attacker could do with it
   - any log lines that help, with private content removed

## What to expect

Waymark is maintained by one person on a best-effort basis. You should get an acknowledgement within a week. I will keep you updated in the advisory, agree on a disclosure date with you once a fix is ready, and credit you in the advisory unless you prefer not to be named.
