---
description: Run a digital audit for one or more named MPs (Graph API data, headlines first, then the two Word docs)
argument-hint: "Name (role)", "Name (role)" [start end]
---

Run a digital audit for: $ARGUMENTS

1. `git pull` first.
2. For each MP, confirm the name matches `roster.json` exactly. If a role (backbencher, frontbencher, minister, first-term MLA, established MLA) isn't given, ask David. Ask about all the missing roles in one question.
3. Period: if no dates are given, use the 90 days ending 2 days ago (insights lag up to 48 hours).
4. Run `node audits/pull.mjs "<name>" <start> <end>` for each MP.
5. Launch one `social-auditor` subagent per MP, in parallel when there's more than one. Each writes headlines only.
6. Show David every MP's headlines in one table, then STOP and wait.
7. Once David approves them, or approves edited versions, have each subagent build its two docs. Then report the file paths and any data caveats.
