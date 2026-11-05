---
name: aside-research
description: Web research through Aside, the AI browser that works in the user's own signed-in browser. Use it from the start when the answer is behind a sign-in (private GitHub pages, Slack, Gmail, cloud consoles, paid docs) or in the user's personal context (their accounts, browsing history, what Aside remembers about them). Switch to it when a page is JS-rendered or blocked to WebFetch and the site has no machine-readable route (an API, llms.txt, the source repository), or when WebSearch results come back thin or out of date. Not for public pages WebFetch reads.
---

# Research through Aside

The `aside` CLI hands a task to Aside's own agent (the model set in the user's Aside settings), which works in the user's signed-in browser with their history and memory. It sees browser pages only, not the terminal.

## When to use it

From the start, when the task needs:
- a signed-in site;
- the user's personal context: their accounts, past browsing, what Aside remembers about them.

Switch to it:
- when WebFetch gets an empty shell from a JS-rendered page, or is blocked (refused, a bot wall). First look for the site's machine-readable route: the API the page loads its data from, `llms.txt`, a sitemap or feed, the source repository. Use Aside when none of them answers;
- when WebSearch results come back thin, off target or out of date.

Do not use it:
- for public pages WebFetch reads: WebFetch is direct, and Aside runs a whole separate agent;
- for checking a web page on screen (its layout, a localhost dev server, a deployed page): that is the `aside-browser` skill's job, where the user has it.

## Before starting

1. Run `aside guide` every time and follow it: commands and flags change between versions, and this skill does not repeat them.
2. If `aside` is missing or will not run (not found, an error, not signed in), tell the user in one line what failed and go back to WebSearch and WebFetch. Never fall back silently.
3. To install or update Aside, follow the `aside-browser` skill's steps, which ask the user first. Do not install or update on your own, and where that skill is absent, only tell the user.

## Running it

Research goes through `aside exec "<task>"`. Only when the research needs a page's DOM itself, read it with `aside repl`, after `aside guide repl`.

- Its output carries page snapshots and Aside's own reasoning along with the answer (19KB for one public page). Send it to a file (the session's scratchpad when there is one, otherwise a temp directory) and read only the final answer at its end.
- Leave `--permission` at its default (Guard); pass `full-access` only when the user asked for it.

## Writing the exec task

Say the question, where to look when you know, and what counts as an answer. Always ask for:
- for each claim, the source URL, the original text quoted, and the date it was accessed;
- what it read on a page kept apart from what it concluded;
- read only: no posting, sending, buying, signing up or changing settings, unless the user asked for that exact action;
- the tabs it opened closed when it is done (otherwise they pile up in the browser's Agent Tabs);
- the format to return.

```bash
aside exec "Research task. Read only.
Question: <the question, with what is already known>.
Where to look: <sites or pages, if known; otherwise say so>.
Rules: only read. Do not post, send, buy, sign up, or change any setting. Close the tabs you opened when you are done.
Return in this format:
- Answer: 2 to 4 sentences.
- Findings, one per line: the claim; [read] if you saw it on the page or [inferred] if you concluded it; the source URL; the exact text quoted; the date you accessed it (YYYY-MM-DD).
- Not found: what you looked for and did not find." > <scratchpad>/aside-exec.txt 2>&1
```

## Handling the result

- Treat it as another AI's secondhand summary, not as a source.
- For each claim your conclusion turns on, open its URL yourself (WebFetch for a public page, `aside repl` for a signed-in one) and check the quote. Say so when it does not hold.
- In your answer, mark what was confirmed through Aside, what you checked yourself, and what is your inference.
- If the repository keeps research notes (such as `docs/research_notes`), follow their marks and dates (such as [공식] official, [커뮤니티] community, [추론] inference, and the access date).

## While it runs

- Give the user a short status about every 60 seconds.
- Going the wrong way: `aside session steer <id> "<correction>"`.
- No longer needed: `aside session stop <id>`.
- A follow-up on the same research: `aside session resume <id> "<follow-up>"`.

## Personal information

- `aside memory search "<query>" --json` only reads. Never edit Aside's memory files; if the user wants Aside to remember something, that goes through `aside exec`.
- Pages seen while signed in can show personal information: names, addresses, messages, account details. Use it to answer the user only. Do not copy it into a public repository's documents or commits; when unsure whether a repository is public, treat it as public.
