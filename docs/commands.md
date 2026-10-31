# Commands

Hi, and welcome. Waymark gives your agent a memory that survives between sessions, so you stop repeating yourself. This page explains the words it uses, then lists every command.

## The words Waymark uses

**Memory.** One small note the agent can keep, like "ask me before pushing anything". Each memory has a title, a body, a kind and a scope.

**Kinds** say what sort of note it is and how the agent gets it:

- `rule`: something that must hold, with a reason. "Ask me before pushing anything." Always shown to the agent.
- `preference`: how you like things done. "Summarize diffs as bullets, no essays." Always shown.
- `fact`: something true about your setup. "Customer data lives only in customers-svc; the others get the UID." Listed in a short index at session start.
- `decision`: a choice and why. "Order events go through Kafka, not RabbitMQ (2026-03-12): we need replay." Needs a reason, listed in the index.
- `gotcha`: a trap, with triggers (file globs, command prefixes, tool names or keywords). "Integration tests hang on my laptop unless the VPN is on." It pops up when the agent touches something that matches.
- `reference`: a pointer to somewhere else, with a locator (URL, path or ticket key). "Acme's incident runbook: https://wiki.acme.dev/incidents." Found by search.

**Scopes** say where a memory applies, from widest to narrowest:

- `user`: you, in every project. "Ask me before pushing anything" or "I like answers in British English."
- `org`: everything from one owner on your git host, like `github.com/acme`. "Acme's incident runbook lives at https://wiki.acme.dev/incidents." Waymark works this out from each repo's `origin` remote, so any repo whose remote is `github.com/acme/...` is in the `github.com/acme` org. `/memory org merge` combines two orgs, say after a rename.
- `product`: a group of repos you link together (though maybe not directly) because they deliver the same product. They may share a domain, but they do not have to. Picture five microservices: one stores customer data and the others only get the customer's UID. A product memory can say so once for all five. Product memories do not have to be technical either: "This product supports credit card payments" is a fine one. You create a product with `/memory link <name>` from inside a repo, and repos can join it the same way. Orgs come from the remote, products are something you decide.
- `repo`: this repository only, such as `github.com/acme/api`, handy for repos you do not own. "Maintainers of upstream/lib want one commit per PR."

**The chain.** In a session, the agent sees your `user` scope plus the org, product and repo you are working in. If two memories disagree, the narrower scope is meant to win: a repo memory beats an org one. Outside a git repo only `user` applies. A repo without a usable remote gets a local id and no org.

## Waymark or AGENTS.md?

Short version: if the whole team should follow it, put it in `AGENTS.md`. That file is committed and reviewed, so everyone gets it. Waymark is for the rest: what is yours, what spans several repos, what lives in repos you do not own, and what the agent picks up along the way.

## A peek inside

Memories are plain markdown files on your machine, one per memory, and you can open and edit them. Nothing leaves your computer. At session start the agent gets a short summary: your rules and preferences in full, plus an index of facts and decisions. While it works, a gotcha pops up when it touches a file or runs a command that matches, and it can search the rest whenever it wants. Waymark never writes inside your repos.

## Slash commands

| Command                            | What it does                               |
|------------------------------------|--------------------------------------------|
| `/memory`                          | List the memories of this session's scopes |
| `/memory review`                   | Show memories that need your attention     |
| `/memory move <id> <scope>`        | Move a memory to another scope             |
| `/memory org merge <keep> <merge>` | Merge one org into another                 |
| `/memory link <product>`           | Link this repo to a product                |
| `/memory unlink`                   | Take this repo out of its product          |
| `/memory setup`                    | Choose a preset or tune the limits         |
| `/remember <text>`                 | Save something as a memory                 |
| `/forget <id or words>`            | Delete a memory                            |

Ids are shown in brackets in listings, like `[01J...]`. You can paste them with or without the brackets. Any other `/memory` word prints this list of subcommands.

### `/memory`

Lists the active memories of every scope in this session, grouped by scope and kind. A replaced memory is not listed. If this repo is linked into a product, the product's repos are shown first.

### `/memory review`

Lists memories worth a second look: replaced ones still on disk, ones missing a required field, facts and decisions that dropped out of the session index, and gotchas that fire often. The agent then goes through them with you: keep, forget, merge into another memory, or turn into a rule. If nothing qualifies it says so.

### `/memory move <id> <scope>`

Moves a memory to `user`, `org`, `product` or `repo`. The target must be one of this session's scopes.

```
/memory move 01J8Z4Q2KXV6N3 org
Moved [01J8Z4Q2KXV6N3] fact · org:github.com/acme · Staging resets nightly (2026-03-02)
```

It is refused if the memory is already there, the session has no such scope, the target would go over its token cap, or the move would bring back a memory that was replaced.

### `/memory org merge <keep> <merge>`

Moves every memory of the second org into the first. Orgs are named `host/owner`. Repos of the merged org use the first org from then on. If it fails halfway, run it again.

```
/memory org merge github.com/acme github.com/acme-labs
Merged org github.com/acme-labs into github.com/acme; memories moved: 2. Sessions in github.com/acme-labs's repos now use github.com/acme.
```

### `/memory link <product>` and `/memory unlink`

A product is a group of repos that share memories (see above). `link` puts this session's repo into the named product (creating it if new); name it with letters, digits and `. _ ~ -`. `unlink` removes this repo from its product; the product's memories stay with the product, and Waymark will not suggest linking those repos again. Both need a session inside a git repo.

```
/memory link payments
Created product payments with github.com/acme/api.
```

Waymark may also ask you in conversation whether two repos belong together; your answer is recorded the same way.

### `/memory setup`

The agent asks whether you want Quick or Advanced. Quick picks a preset. Advanced walks through each setting (see Settings). Nothing changes until you answer. On first use Waymark shows a toast pointing here.

### `/remember <text>`

The agent picks a kind and scope, then saves. A rule needs a reason and a gotcha needs triggers, so it may ask. If similar memories exist it shows them and asks whether yours updates one, replaces one, or is new.

```
/remember I prefer pnpm over npm, in every project
```

### `/forget <id or words>`

With an id, deletes that memory. With words, searches, shows the matches and asks which to delete. This is the only way memories are deleted, and it is permanent.

## Agent tools

The agent calls these for you. You rarely need them directly.

| Tool | Purpose |
| --- | --- |
| `memory_save` | Save a memory; shows related ones first if any exist |
| `memory_update` | Change fields of a memory by id |
| `memory_read` | Read one memory in full |
| `memory_search` | Search memories by words or meaning, optionally by kind or scope |
| `memory_forget` | Delete a memory |
| `memory_config` | Change settings |
| `memory_command` | Runs the `/memory` subcommands above |
| `memory_link` | Records your answer about linking repos into a product |

## Kind details

`rule`, `preference` and `gotcha` can also carry an optional `howToApply`: one line, up to 200 characters, saying when or where the memory applies. It is shown as "Applies:".

Memory lines in the session block and in recalled gotchas show the date the memory was last updated.

## Where things live

Memories are plain files under `$XDG_DATA_HOME/waymark/` (default `~/.local/share/waymark/`), one markdown file per memory with YAML frontmatter, laid out as `<scope>/<kind>/<id>.md`. You can read and edit them by hand. Everything else in that folder (search cache, registry) can be deleted and is rebuilt. Waymark never writes inside your repos.

| What | Where |
| --- | --- |
| Memories | `$XDG_DATA_HOME/waymark/{user,orgs,products,repos}/...` |
| Config | `$XDG_DATA_HOME/waymark/config.jsonc` |
| Embedding model | `$XDG_DATA_HOME/waymark/models/` |
| Log | `$XDG_STATE_HOME/waymark/waymark.log` (default `~/.local/state/waymark/`) |

## Settings

`config.jsonc` is optional and created when you change a setting. `/memory setup` is the easy way to edit it; the file also accepts comments. Unknown keys or bad values make Waymark fall back to the defaults; `/memory setup` will not overwrite a broken file.

| Key | Meaning | Default |
| --- | --- | --- |
| `preset` | `lean`, `balanced` or `rich` | `balanced` |
| `caps` | Token limit for rules and preferences per scope: `user`, `org`, `product`, `repo` | from preset |
| `indexLines` | Most facts and decisions listed at session start | from preset |
| `indexExit` | `sessions` and `days` a fact or decision must go unread before leaving the index; both must pass | 20 sessions, 30 days |
| `subagents` | Agent names whose subagent sessions also get memory | none |
| `compactionSave` | Ask the agent to save memories before context is compacted | `true` |
| `toasts` | Show Waymark notifications | `true` |

Presets (caps in tokens for user, org, product, repo; index lines):

| Preset | Caps | Index lines |
| --- | --- | --- |
| lean | 200, 300, 150, 300 | 20 |
| balanced | 400, 600, 300, 600 | 40 |
| rich | 800, 1200, 600, 1200 | 80 |

```jsonc
{
  "preset": "balanced",
  "caps": { "repo": 900 },
  "toasts": false
}
```

Setting `caps` or `indexLines` overrides the preset; switching preset clears them. Index size, index exit and subagents apply from the next session.
