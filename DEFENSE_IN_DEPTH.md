# Defense in Depth

Tracking against https://github.com/jaredwray/agentic/blob/main/skills/security/defense-in-depth-nodejs/SKILL.md.

Profile: npm library · public

## 1. Security docs

- [ ] `SECURITY.md` present — contact info + "How this repository is secured" summary (PR #227 pending)
- [ ] `DEFENSE_IN_DEPTH.md` present (this file) (PR #227 pending)

## 2. Repository lockdown

- [ ] `.github/CODEOWNERS` covers `/.github/`, `/.cursor/`, `/.devcontainer/`, `/scripts/` with owners the maintainer names
- [ ] Lockdown script run; `lockdown-repo.sh --check` passes clean
- [ ] Pull requests required on the default branch (0 required approving reviews, last-push approval off, code-owner review of owned paths, Restrict updates off; the owner may merge without a review); force pushes and deletion blocked
- [ ] Merges blocked unless required status checks pass (`--required-checks "<repo's CI jobs>"`)
- [ ] Tag ruleset "Tags only by admins" active
- [ ] Workflow runs from all outside collaborators require approval
- [ ] Default workflow token read-only; Actions cannot create or approve PRs
- [ ] Actions allowlist: GitHub-owned + verified + explicit patterns only (`--allowed-actions`)
- [ ] Secret scanning + push protection enabled *(plan-gated on private repos)*
- [ ] Private vulnerability reporting enabled *(public repos only)*
- [ ] Dependabot alerts enabled
- [ ] Dependabot rule: auto-dismiss low + medium (manual)
- [ ] Phishing-resistant 2FA (passkeys / hardware keys) on the GitHub and npm accounts (manual)
- [ ] Recovery codes stored offline in a password manager (manual)
- [ ] Codespaces and Cursor Cloud Agents bootstrap Aikido Safe Chain via scripts/setup-cloud-environment.sh (--ci shims, frozen lockfile)

## 3. Dependencies (pnpm)

- [x] `packageManager: pnpm@11.x` pinned in `package.json` — verified on main
- [x] 7-day cooldown: `minimumReleaseAge: 10080`, `minimumReleaseAgeStrict: true`, `minimumReleaseAgeIgnoreMissingTime: false` — verified on main (`minimumReleaseAgeExclude: hookified`)
- [x] Lifecycle scripts blocked: `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, `allowBuilds: {}` baseline — verified on main (reviewed `allowBuilds`: esbuild, sharp, unrs-resolver, workerd, zeromq)
- [x] `blockExoticSubdeps: true` — verified on main
- [x] Lockfile committed; CI installs with `pnpm install --frozen-lockfile` — verified on main
- [x] Dependency-update tooling opens PRs only — never auto-merge — verified on main (no Dependabot/Renovate auto-merge)
- [x] New direct dependencies get human review; prefer `~` ranges over `^` — verified standing practice (existing ranges unchanged)

## 4. GitHub Actions

- [ ] `permissions: contents: read` (or `{}` + per-job grants) on every workflow
- [x] Every action pinned to a full commit SHA (`npx actions-up`) — verified on main
- [ ] Every job installs Socket Firewall (`SocketDev/action` SHA-pinned, `firewall-version` pinned); `pnpm install` / `npm install` run as `sfw pnpm install` / `sfw npm install`
- [ ] `.github/workflows/check-workflows.yaml` lints workflows with zizmor on every PR
- [ ] `persist-credentials: false` on checkouts that don't push
- [x] No `pull_request_target` on workflows that run untrusted PR code — verified on main
- [ ] Artifact-publishing workflows disable `actions/setup-node` default caching (`package-manager-cache: false`) to prevent cache poisoning
- [x] No npm tokens (or other registry credentials) in Actions secrets — verified on main

## 5. npm publishing — npm libraries only

- [ ] OIDC trusted publishing configured **stage-only** on npmjs.com for the publish workflow — it can stage, never publish live (manual)
- [ ] Staged publishing: CI runs `npm stage publish`; a maintainer promotes with 2FA (manual)
- [ ] Drydock connected — staged releases reviewed before promotion (manual)
- [ ] No direct publish rights: package requires 2FA and disallows tokens (manual)
- [x] `package.json` `repository.url` accurate so provenance maps to this repo — verified on main

## 6. Security tooling

- [ ] Aikido runs on every build
- [ ] Aikido release gate: the release workflow's stage-publish job `needs:` a passing `scan-release`
- [x] Socket reviews every PR that changes dependencies — verified on main
