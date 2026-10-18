# WA Labor social repo

This repo does two jobs for David Cann (Director of Strategy, WA Labor):

1. **The leaderboard.** It's live and runs daily on its own. Read `HANDOVER.md` before touching anything in `scripts/`, `data.json`, `roster.json` or `snapshots/`.
2. **Social media audits.** These are new and live in `audits/`. Whenever David asks for a digital audit in plain words ("digital audit Rita Saffioti", "do a digital audit for Daniel"), run the `/digital-audit` flow in `.claude/commands/digital-audit.md`, and ask him for anything missing. The full build brief is `audits/BRIEF.md`, so read it before any audit work. The per-MP analysis agent is `.claude/agents/social-auditor.md`.

## Rules that apply to everything

- Run `git pull` before any local run. The daily Action commits to `master`.
- Credentials live in `.env` only, which is gitignored. Never print a token, never commit one, and never ask David to paste one into chat. If one is missing, tell him which variable to add to `.env`.
- Never change the leaderboard's scripts, roster or snapshots as part of audit work. Audit code goes in `audits/` and reads `roster.json` read-only.
- Audit data and finished documents (`audits/data/`, `audits/output/`) are gitignored. They hold MP performance data and stay on David's machine.
- Never invent a number. Every figure in an audit has to trace to an API response saved in `audits/data/`. If a metric isn't available, say so in the doc rather than estimating it.

## How David works

- Scope first, then work quietly. Surface results to react to, not a running commentary.
- Ask one question at a time, and only when blocked.
- Plain English, AU spelling. No em dashes, no corporate filler.
- Stop at the checkpoints marked **STOP** in `audits/BRIEF.md` and report before carrying on.
