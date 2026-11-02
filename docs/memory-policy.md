# What belongs in a memory

A memory holds what you would otherwise have to tell the agent again, and what the code, the repo and its docs cannot tell it.

That is the whole idea. The agent can already read your code, your config and your git history, and it does that better than any note could, because the code is always current. A memory is for the things nobody wrote down there: why you chose something, who owns what, how you like to work, the trap that only bites on your machine.

When a note repeats what the code says, it only gets in the way. It goes stale without a sound, and then the agent trusts the stale note over the code. So Waymark asks the agent to be picky, and to tell you what it left out and why.

## A few examples

**Functional detail becomes nothing.**

> You: Remember that the orders service calls `GET /v1/customers/{id}` to fetch customers.

The endpoint is in the orders code, so a copy would only drift. The agent saves nothing and says so: it can read that call whenever it needs it.

**A mixed request keeps the part that lasts.**

> You: Remember that orders calls `/v1/customers` because customers owns the customer PII.

The endpoint stays in the code. What the agent saves is the boundary: "customers owns the customer PII." That is a decision about who is responsible, and no file shows it.

**A team convention goes to `AGENTS.md`.**

> You: Remember that we format with Prettier and run it before every commit.

If everyone working in the repo should follow it, it belongs in `AGENTS.md`, which is committed and reviewed. The agent suggests that and offers to help you word it. It never writes into your repos itself.

**A secret becomes a pointer.**

> You: The staging password is hunter2, remember it.

The agent never copies a secret into a memory. It saves where the secret lives instead: "Staging credentials are in the 1Password vault Staging."

## The four checks

Before saving, the agent asks itself, in this order:

1. **Can it be read from code, config, git history or the repo's docs** (this repo or a sibling)? Then it is not a memory. The agent reads it when it needs it.
2. **Is it true for everyone working in this repo?** Then it belongs in `AGENTS.md`. Waymark can suggest that, but it never writes there.
3. **Is it a secret, or someone else's personal data?** Then it saves only a pointer to where it lives.
4. **Is it only about the task at hand?** Then it is not a memory.

When a check fails, the agent tells you which one and offers the alternative: read the code, or put it in `AGENTS.md`.

## What belongs

- **Why.** Decisions and the reasons behind them, dated.
- **Responsibilities and boundaries.** "customers-svc owns customer PII; the others only get the UID."
- **Business rules that live in tickets or heads, not in code**, with a pointer to the source.
- **Your rules and preferences.** "Ask me before pushing anything."
- **Traps the code does not reveal.** Environment, infrastructure, people. "Integration tests hang unless the VPN is on."
- **Pointers** to things outside the repo: runbooks, dashboards, tickets.
- **Process and people.** "Schema changes in billing need the finance team's sign-off."

## What does not

- Contracts: endpoints, signatures, schemas, event names and payloads.
- Dependency lists, call graphs, file maps, summaries of what code does.
- Copies of docs, READMEs or `AGENTS.md`.
- Config values, versions, build or run steps that a script already holds.
- Task progress, todo lists, what was done in this session.
- Secrets.

## How Waymark applies it

Waymark ships this policy as a skill called `waymark-save`. The agent loads it just before it saves or updates a memory, so its full text costs nothing the rest of the time. The skill also helps pick a kind and scope and reminds the agent to write the why. On a host without skills, the same text is part of the session instructions instead.

Waymark never reads your memories to judge them. The agent does, with you: `/memory review` also asks it to point out memories that no longer pass these checks, and offers to forget them or move them.
