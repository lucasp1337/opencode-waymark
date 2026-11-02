---
name: waymark-save
description: Load before saving or updating a Waymark memory (memory_save, memory_update, /remember). Says what belongs in memory, which kind and scope to pick, and how to write it.
---

# Saving a Waymark memory

A memory holds what the user would otherwise have to tell you again, and what the code, the repo and its docs cannot tell you.

## Check before saving, in this order

1. Can it be read from code, config, git history or the repo's docs, in this repo or a sibling repo? Do not save it. Read it when you need it.
2. Is it true for everyone working in this repo? It belongs in `AGENTS.md`. Suggest that to the user; never write it there yourself.
3. Is it a secret, or someone else's personal data? Never copy a secret (token, password, key, connection string) into any field, even when the user asks. Save only where it lives, as a reference. For personal data, save at most a pointer to where it lives.
4. Is it only about the task at hand (progress, a todo, one file or line)? Do not save it.

When a check fails, tell the user which one and offer the alternative.

When a request mixes both, save the part that passes and say what you left out and why. "Remember that orders calls /v1/customers because customers owns the PII" becomes "customers owns the customer PII"; the endpoint stays in the code.

## What belongs in memory

- Why: decisions and their reasons, dated.
- Responsibilities and boundaries: "customers-svc owns customer PII; the others only get the UID."
- Business rules that live in tickets or in people's heads, with a pointer to the source.
- The user's rules and preferences.
- Traps the code does not show: environment, infrastructure, people.
- Pointers to things outside the repo: runbooks, dashboards, tickets.
- Process and people: "Schema changes in billing need the finance team's sign-off."

## What does not

- Contracts: endpoints, signatures, schemas, event names and payloads.
- Dependency lists, call graphs, file maps, summaries of what code does.
- Copies of docs, READMEs or `AGENTS.md`.
- Config values, versions, build or run steps that a script already holds.
- Task progress, todo lists, what was done in this session.
- Secrets.

## Kind: the cheapest one that still works

Kinds reach future sessions differently. Pick the cheapest that still gets the memory there in time:

- Needed only when touching certain files, commands or tools: `gotcha`, with triggers. Use it for something that took more than one attempt to get right.
- Needed only sometimes: `fact` or `decision` (listed in the session index; a decision needs its reason), or `reference` (found by search; needs a locator).
- Must hold in every turn: `rule` (with a reason) or `preference`. If it must be known before acting, make it a rule, not a gotcha.

## Scope

Would it hold in another repo of the same org? Yes: `org`, or `user` if it is about the person. Only in the repos linked into this product: `product`. Otherwise: `repo`.

## Aiming a memory at a repo

In a product, a memory about one repo of it can carry `triggers.repos` (full repo ids, listed by `/memory triggers repos`; a save naming an unknown id is refused with the product's member ids): it is then listed with that repo's name and delivered in full when you touch that repo's work tree. Only at product scope, only for repos of that product, on any kind. A `fact` or `decision` fits a role or boundary ("customers owns the customer PII; the others only get the UID"), a `rule` fits a process ("schema changes in billing need the finance team's sign-off").

Say who owns what, which boundary holds, which process applies, and why. Not the contract: endpoints, schemas, event names, dependencies, or what the repo's code does. A sibling's checkout, where the map shows one, may be read to check a contract. Changing anything outside the current repo needs the user's go-ahead.

## Writing it

- Write the why, not only the what. For a rule, preference or gotcha, put when it matters and what to do in `howToApply`.
- Dates are absolute (2026-03-05), never "yesterday" or "next week".
- Before saving, check the related memories shown. Prefer updating over adding: relation `updates:<id>` to fix or extend one, `supersedes:<id>` when the old one no longer holds, `new` only if it is truly different.
