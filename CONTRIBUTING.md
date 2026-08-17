# Contributing

This repo follows the [gitflow](https://nvie.com/posts/a-successful-git-branching-model/)
branching model, as a convention — no `git-flow` CLI extension required, just
plain git.

## Branches

- **`master`** — production. Only moves via a merged `release/*` or
  `hotfix/*` PR.
- **`develop`** — integration branch. Only moves via a merged `feature/*`
  PR.
- **`feature/<name>`** — new work. Branches off `develop`, merges back into
  `develop` via PR.
- **`release/<version>`** — stabilizes a release (version bump, changelog,
  last-minute fixes only). Branches off `develop`, merges into both
  `master` and `develop`.
- **`hotfix/<name>`** — urgent fix straight to production. Branches off
  `master`, merges into both `master` and `develop`.

> This repo currently also has an `origin/main`, left over from before
> `develop`/`master` were adopted as the gitflow pair. Treat `master` as the
> real production branch until `main` is cleaned up or repurposed.

## Enforcement

- **Direct pushes to `develop` or `master` are blocked locally** by
  [`.githooks/pre-push`](.githooks/pre-push). Running `npm install` wires it
  up automatically via the `prepare` script (`git config core.hooksPath
  .githooks`), so this applies to every clone, not just one machine.
  Escape hatch for the rare legitimate case: `SKIP_PUSH_PROTECTION=1 git
  push`.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
  `typecheck`, `test`, and `build` on every push and every PR — this is
  what actually gates a PR being mergeable, independent of the local hook.

## Typical flow

```bash
git checkout develop
git pull
git checkout -b feature/my-thing

# ... commit work ...

git push -u origin feature/my-thing
gh pr create --base develop
```

Releases and hotfixes follow the same shape, just branching off `develop`
(release) or `master` (hotfix), and opening PRs into both `master` and
`develop` when finishing.
