# Product atlas

Product atlas lets your agent know where each repository of a product lives and what the code cannot tell it about each one. Who owns what, which boundary holds, which process applies: you say it once, and the agent has it in hand the moment it steps into the right repo. No more "customers owns the customer data, it is checked out at `~/src/customers`, go look there before you change this call."

It builds on [products](../guide.md), the groups of repos you link together. The atlas adds two things: a one-line map of the product at the top of every session, and a way to aim a memory at one repo so it shows up exactly when the agent works there.

## A worked example

You work in `github.com/acme/orders`. The product `payments` also holds `customers`, `billing` and `invoice-pdf`.

**Link the repos.** From inside each repo:

```
/memory link payments
```

Waymark also remembers where each repo is checked out on your machine, as sessions run in them. You do nothing for that.

**Save what the code cannot tell.** You tell the agent:

> customers owns the customer PII; the other repos only ever get the customer UID.

It saves a `decision` at product scope, aimed at the `customers` repo, with the reason.

**Start a session in `orders`.** The session block now carries the map:

```
Product payments: orders (here) · customers ~/src/customers · billing ~/src/billing · invoice-pdf (no checkout seen)
```

and the memory in the index, prefixed with the repo it is about:

```
- [01J8Z4Q2KXV6N3] [customers] customers owns the customer PII; the other repos only ever get the customer UID. (2026-03-12)
```

**Read a file in `~/src/customers`.** The agent opens a file there to check something, and the full memory, with its reason, is delivered right then, once for the session. The agent now knows whose data this is before it changes the call.

## Aiming a memory at a repo: `triggers.repos`

A memory can carry a `repos` trigger next to `paths`, `commands`, `tools` and `keywords`: a list of repo ids. It fires when a tool call touches the work tree of one of those repos.

- Any kind can carry it. A role or boundary is a `fact` or `decision`; a process is a `rule`.
- Only at product scope, and only for repos that are in that product when you save. Anything else is refused with the reason, and with the product's repos when an id is unknown.
- A memory with `repos` is never shown in full at the start of a session, whatever its kind. It is listed in the index with the repo's short name, like any other index line and within the same budget, and delivered in full when its repo is touched.

What belongs in such a memory follows the [memory policy](../memory-policy.md): ownership, boundaries, process, and why. Never contracts (endpoints, schemas, event names), dependency lists, or a summary of what a repo's code does. The code is where those are true, and the memory points the agent at the right sibling to read.

## Checkouts

Waymark records, per repo, the work tree last seen by a session, and when. It is machine-local, so it lives in Waymark's own registry and never in a memory file: memories you copy to another machine carry no paths.

It is updated when a session starts in a repo and when a tool call touches a repo's work tree. With several worktrees of one repo, the most recently seen wins. Because the repo is identified in the background, a repo is first noticed on the call after the one that touched it.

## The map line

The map is built only from the registry, never from memory text. It replaces the bare list of repos in the session block when the session's repo is in a product, and is frozen for the session like the rest of the block.

- Your repo comes first, marked `here`; the others follow in the order they were linked, by short name.
- A path is shown only while its `.git` still exists. Otherwise the map says `no checkout seen`.
- The line has a length cap. Repos that do not fit become `+N more, see /memory triggers repos`.

If the registry cannot be read, the block falls back to the plain list of repos and the problem goes to the log.

## `/memory triggers repos`

`/memory triggers` lists the triggered memories reachable from this session, grouped by trigger field and then by value, each with its id, kind, scope and title. Name a field (`paths`, `commands`, `tools`, `keywords`, `repos`) to see only that one.

For `repos` it is the full map. Every member of the product appears with its full id and its checkout or `no checkout seen`, with the memories aimed at it, and repos no memory is aimed at say so. A last group holds memories whose repo has left the product. Outside a product, the section says so.

## Review, unlink and move

- `/memory review` also lists memories aimed at a repo that left the product, and repos of the product that no memory is aimed at.
- `/memory unlink`: memories aimed at the repo stay with the product, like all product memories, but stop firing for that repo.
- `/memory move` refuses to move a memory with `repos` out of product scope, and refuses a move to another product whose repos do not include its targets. Remove or change `triggers.repos` with `memory_update` first.

## What Waymark never does

- It never writes inside your repositories. Checkouts live in Waymark's registry.
- It never reads code, OpenAPI files or manifests to work out roles or contracts. The map comes from the registry, the roles from what you and the agent saved.
- It does not nag the agent to write role notes. The one nudge is a line in the tool result when the agent first touches a repo of the product that no memory is aimed at: nothing says what it owns yet, and if you explain its role it can be saved with `triggers.repos`. It appears once per repo and session and costs nothing in the session block. `/memory review` lists the repos that still have no memory.
