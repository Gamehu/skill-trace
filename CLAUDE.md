# skill-trace

Local, read-only dashboard for Claude Code skills and their runs. See README.md.

## Commits

- Every commit in this repository is authored and committed as `Gamehu <gamehu@yeah.net>`.
  Set it before committing: `git config user.name Gamehu && git config user.email gamehu@yeah.net`.
- No other names or emails in commits: no `Co-Authored-By` trailers, no attribution footers.

## Checks before pushing

```bash
npm run typecheck && npm test && npm run build
```

`npm run demo` serves seeded fake data (including one live session) for checking the UI.
