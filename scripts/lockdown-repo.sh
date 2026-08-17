#!/usr/bin/env bash
# lockdown-repo.sh — one-shot GitHub repo lockdown for the defense-in-depth-nodejs skill.
#
# Applies the "Repository lockdown" settings (DEFENSE_IN_DEPTH.md § 2) to a repo:
#
#   1. Default workflow token permissions: read-only; Actions cannot create/approve PRs
#   2. Workflow runs from ALL outside collaborators require owner approval
#   3. Branch ruleset on the default branch: pull request required with 0
#      approving reviews and last-push approval off, plus a code-owner review of
#      owned paths; Restrict updates off; the owner may merge without a review
#      (pull-request bypass) but cannot push directly; force pushes and deletion
#      blocked; with --required-checks, merges are also blocked unless those
#      status checks pass.
#      CODEOWNERS must exist on the default branch (the review flag is a no-op
#      without it)
#   4. Tag ruleset "Tags only by admins": only repository admins can create tags
#   5. Secret scanning + push protection (plan-gated on private repos)
#   6. Private vulnerability reporting (public repos only)
#   7. Dependabot vulnerability alerts
#   8. Actions allowlist: GitHub-owned + verified creators + explicit patterns only
#
# Requires: gh (https://cli.github.com) authenticated as a repository admin.
# Everything it does is idempotent — safe to re-run any time.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: lockdown-repo.sh [owner/repo] [--check] [--required-checks "<c1,c2>"] [--allowed-actions "<p1,p2>"]

  owner/repo          Target repository. Defaults to the repo of the current directory.
  --check             Audit only: report PASS/FAIL per setting, change nothing.
                      Exits 1 if any applicable setting is not in the desired state.
  --required-checks   Comma-separated status-check names (job names) that must pass
                      before merging into the default branch, e.g. "test,zizmor".
  --allowed-actions   Extra action patterns for the allowlist, e.g. "changesets/*".
                      GitHub-owned, verified creators, zizmorcore/*, and SocketDev/* are always allowed.

Requires gh authenticated as a repository admin. Idempotent — safe to re-run.
EOF
}

REPO=""
CHECK=0
REQUIRED_CHECKS=""
EXTRA_PATTERNS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK=1 ;;
    --required-checks) REQUIRED_CHECKS="${2:-}"; shift ;;
    --allowed-actions) EXTRA_PATTERNS="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) REPO="$1" ;;
  esac
  shift
done

command -v gh >/dev/null || { echo "error: gh CLI is required (https://cli.github.com)"; exit 1; }

if [[ -z "$REPO" ]]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null) ||
    { echo "error: not inside a repo checkout — pass owner/repo explicitly"; exit 1; }
fi

echo "Repository: $REPO"

gh api "repos/$REPO" --jq .full_name >/dev/null 2>&1 ||
  { echo "error: cannot read repos/$REPO — check the name and your gh auth"; exit 1; }
PRIVATE=$(gh api "repos/$REPO" --jq .private)
DEFAULT_BRANCH=$(gh api "repos/$REPO" --jq .default_branch)
OWNER_TYPE=$(gh api "repos/$REPO" --jq .owner.type)
OWNER_ID=$(gh api "repos/$REPO" --jq .owner.id)
IS_ADMIN=$(gh api "repos/$REPO" --jq '.permissions.admin // false' 2>/dev/null || echo false)

echo "Default branch: $DEFAULT_BRANCH · Private: $PRIVATE · You are admin: $IS_ADMIN"
if [[ "$IS_ADMIN" != "true" && "$CHECK" -eq 0 ]]; then
  echo "error: applying settings requires admin permission on $REPO (use --check to audit)"
  exit 1
fi
echo

FAILS=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILS=$((FAILS + 1)); }
skip() { echo "  - $1 (skipped: $2)"; }

# ---------------------------------------------------------------------------
step() { echo "[$1] $2"; }

# 1. Workflow token permissions -------------------------------------------------
step 1 "Default workflow token permissions"
WF_PERM=$(gh api "repos/$REPO/actions/permissions/workflow" --jq .default_workflow_permissions 2>/dev/null || echo "")
WF_APPROVE=$(gh api "repos/$REPO/actions/permissions/workflow" --jq .can_approve_pull_request_reviews 2>/dev/null || echo "")
if [[ "$WF_PERM" == "read" && "$WF_APPROVE" == "false" ]]; then
  pass "token is read-only and Actions cannot create/approve PRs"
elif [[ "$CHECK" -eq 1 ]]; then
  fail "want default_workflow_permissions=read + can_approve_pull_request_reviews=false, have ${WF_PERM:-?}/${WF_APPROVE:-?}"
else
  gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
    -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
  pass "set token read-only; Actions can no longer create/approve PRs"
fi

# 2. Approval required for all outside collaborators ---------------------------
step 2 "Workflow run approval for fork PRs"
AP=$(gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy 2>/dev/null || echo "")
if [[ "$AP" == "all_external_contributors" ]]; then
  pass "all outside collaborators require approval to run workflows"
elif [[ "$CHECK" -eq 1 ]]; then
  fail "want approval_policy=all_external_contributors, have ${AP:-unset}"
else
  if gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
       -f approval_policy=all_external_contributors >/dev/null 2>&1; then
    pass "owner approval now required for every outside collaborator's workflow run"
  else
    fail "could not set fork-PR approval policy (endpoint may be unavailable on this plan)"
  fi
fi

# 3+4. Rulesets ------------------------------------------------------------------
# A ruleset is judged by its contents, never by its name alone — a pre-existing
# weak ruleset with the right name must not pass the audit. Check mode fetches the
# ruleset and validates enforcement, rule types, review count (0), last-push
# approval off, code-owner review, Restrict updates off, targets, and bypass
# list; apply mode always writes the canonical config (create or overwrite),
# which also heals a weak same-name ruleset.

ruleset_id() { # $1=name → repo-level ruleset id, or empty
  gh api "repos/$REPO/rulesets?includes_parents=false" --paginate \
    --jq ".[] | select(.name == \"$1\") | .id" 2>/dev/null | head -1
}

# Rulesets on private repos are plan-gated (GitHub Pro/Team). Probe with an empty
# POST body: a 422 validation error means the feature is available, a 403 means the
# plan doesn't include it. The probe never creates anything.
rulesets_supported() {
  [[ "$PRIVATE" != "true" ]] && return 0
  local out
  out=$(gh api -X POST "repos/$REPO/rulesets" --input /dev/null 2>&1) && return 0
  ! grep -q "HTTP 403" <<<"$out"
}

ruleset_compliant() { # $1=id $2=jq filter that prints "ok" for a compliant ruleset
  [[ -n "$1" ]] && [[ "$(gh api "repos/$REPO/rulesets/$1" --jq "$2" 2>/dev/null)" == "ok" ]]
}

# Ruleset helper: create or update a repo ruleset by name from JSON on stdin.
upsert_ruleset() { # $1=name
  local id
  id=$(ruleset_id "$1")
  if [[ -n "$id" ]]; then
    gh api -X PUT "repos/$REPO/rulesets/$id" --input - >/dev/null
    pass "wrote ruleset \"$1\" (id $id, existing config replaced)"
  else
    gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null
    pass "created ruleset \"$1\""
  fi
}

# With --required-checks, the branch ruleset also carries a required_status_checks
# rule; both the written JSON and the compliance filter include each named check.
BR_CHECKS_RULE=""
BR_CHECKS_FILTER=""
if [[ -n "$REQUIRED_CHECKS" ]]; then
  CTX_JSON=""
  IFS=',' read -ra _checks <<<"$REQUIRED_CHECKS"
  for c in "${_checks[@]}"; do
    c="${c# }"; c="${c% }"
    [[ -z "$c" ]] && continue
    CTX_JSON+="{ \"context\": \"$c\" },"
    BR_CHECKS_FILTER+=" and (\$ctxs | index(\"$c\"))"
  done
  CTX_JSON="${CTX_JSON%,}"
  BR_CHECKS_RULE=",
    { \"type\": \"required_status_checks\",
      \"parameters\": {
        \"strict_required_status_checks_policy\": false,
        \"required_status_checks\": [ $CTX_JSON ]
      } }"
fi

# Owner on the bypass list in pull_request mode: they can merge without a
# code-owner review, but cannot push directly. Restrict updates stays off so
# other writers can still merge once the remaining rules pass. User-owned
# repo → the owner user; org-owned repo → organization owners.
case "$OWNER_TYPE" in
  Organization)
    BR_BYPASS_JSON='{ "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "pull_request" }'
    BR_BYPASS_FILTER='.actor_type == "OrganizationAdmin" and .bypass_mode == "pull_request"'
    ;;
  User)
    [[ "$OWNER_ID" =~ ^[0-9]+$ ]] || { echo "error: unexpected owner id: $OWNER_ID"; exit 1; }
    BR_BYPASS_JSON="{ \"actor_id\": $OWNER_ID, \"actor_type\": \"User\", \"bypass_mode\": \"pull_request\" }"
    BR_BYPASS_FILTER=".actor_id == $OWNER_ID and .actor_type == \"User\" and .bypass_mode == \"pull_request\""
    ;;
  *)
    echo "error: unsupported repository owner type: ${OWNER_TYPE:-unset}"
    exit 1
    ;;
esac

BR_COMPLIANT='([.rules[] | select(.type == "required_status_checks")
    | .parameters.required_status_checks[].context]) as $ctxs
  | if .enforcement == "active"
  and ([.rules[].type] | index("pull_request") and index("deletion") and index("non_fast_forward"))
  and (([.rules[].type] | index("update")) == null)
  and (any(.rules[]; .type == "pull_request"
    and (.parameters.required_approving_review_count // 0) == 0
    and .parameters.require_code_owner_review == true
    and (.parameters.require_last_push_approval // false) == false))
  and (.conditions.ref_name.include | index("~DEFAULT_BRANCH"))
  and ((.bypass_actors // []) | length == 1)
  and ((.bypass_actors // [])[0] | '"$BR_BYPASS_FILTER"')'"$BR_CHECKS_FILTER"'
  then "ok" else "weak" end'

TAG_COMPLIANT='if .enforcement == "active"
  and ([.rules[].type] | index("creation"))
  and (.conditions.ref_name.include | index("~ALL"))
  then "ok" else "weak" end'

RULESETS_OK=1
rulesets_supported || RULESETS_OK=0

step 3 "Branch ruleset: pull requests required on $DEFAULT_BRANCH"
BR_NAME="Pull requests required"
if [[ "$RULESETS_OK" -eq 0 ]]; then
  skip "branch ruleset \"$BR_NAME\"" "rulesets on private repos need GitHub Pro/Team"
elif [[ "$CHECK" -eq 1 ]]; then
  BR_ID=$(ruleset_id "$BR_NAME")
  if ruleset_compliant "$BR_ID" "$BR_COMPLIANT"; then
    pass "ruleset \"$BR_NAME\" is active with 0 required reviews, last-push approval off, code-owner review, Restrict updates off, PR/deletion/force-push rules on the default branch"
  elif [[ -n "$BR_ID" ]]; then
    fail "ruleset \"$BR_NAME\" exists but does not match the canonical config (rules, review count, last-push approval, code-owner review, Restrict updates, target, enforcement, or bypass list)"
  else
    fail "no ruleset \"$BR_NAME\""
  fi
else
  # Restrict updates off. Owner on the bypass list in pull_request mode: they
  # can merge without a review, but cannot push directly.
  BR_JSON=$(cat <<JSON
{
  "name": "Pull requests required",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    $BR_BYPASS_JSON
  ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      } },
    { "type": "deletion" },
    { "type": "non_fast_forward" }$BR_CHECKS_RULE
  ]
}
JSON
)
  if printf '%s' "$BR_JSON" | upsert_ruleset "$BR_NAME"; then :; else
    fail "could not write branch ruleset"
  fi
fi

# require_code_owner_review does nothing unless a CODEOWNERS file on the default
# branch names at least one owner. The file itself is a PR (see reference.md);
# this script only audits it. GitHub binds to the first of these paths that
# exists — even if that file is empty or has no owners — so do not fall through.
codeowners_fetch() { # $1=path → raw body; return 1 if missing
  gh api -H "Accept: application/vnd.github.raw" \
    "repos/$REPO/contents/${1}?ref=$DEFAULT_BRANCH" 2>/dev/null
}

# `@` after `#` is an inline comment, not an owner.
codeowners_has_owner() {
  grep -qE '^[[:space:]]*[^#[:space:]][^#]*@' <<<"$1"
}

CO_FOUND=""
for p in ".github/CODEOWNERS" "CODEOWNERS" "docs/CODEOWNERS"; do
  if body=$(codeowners_fetch "$p"); then
    if codeowners_has_owner "$body"; then
      CO_FOUND=$p
    fi
    break
  fi
done
if [[ -n "$CO_FOUND" ]]; then
  pass "CODEOWNERS at $CO_FOUND names at least one owner"
else
  fail "no CODEOWNERS with owners on $DEFAULT_BRANCH (want .github/CODEOWNERS covering high-risk paths)"
fi

step 4 "Tag ruleset: tags only by admins"
TAG_NAME="Tags only by admins"
if [[ "$RULESETS_OK" -eq 0 ]]; then
  skip "tag ruleset \"$TAG_NAME\"" "rulesets on private repos need GitHub Pro/Team"
elif [[ "$CHECK" -eq 1 ]]; then
  TAG_ID=$(ruleset_id "$TAG_NAME")
  if ruleset_compliant "$TAG_ID" "$TAG_COMPLIANT"; then
    pass "ruleset \"$TAG_NAME\" is active with creation restricted on all tags"
  elif [[ -n "$TAG_ID" ]]; then
    fail "ruleset \"$TAG_NAME\" exists but is weaker than required (rules, target, or enforcement)"
  else
    fail "no ruleset \"$TAG_NAME\""
  fi
else
  # bypass actor 5 = the "Repository admin" role
  if upsert_ruleset "$TAG_NAME" <<'JSON'
{
  "name": "Tags only by admins",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": { "ref_name": { "include": ["~ALL"], "exclude": [] } },
  "rules": [ { "type": "creation" } ]
}
JSON
  then :; else
    fail "could not write tag ruleset"
  fi
fi

# 5. Secret scanning + push protection ------------------------------------------
step 5 "Secret scanning + push protection"
# "disabled but available" must fail the audit; only genuine unavailability (the
# security_and_analysis key is absent — no Secret Protection on this plan) is a skip.
SS=$(gh api "repos/$REPO" --jq \
  'if (.security_and_analysis // {}) | has("secret_scanning") then .security_and_analysis.secret_scanning.status else "unavailable" end' \
  2>/dev/null || echo unavailable)
SSPP=$(gh api "repos/$REPO" --jq \
  'if (.security_and_analysis // {}) | has("secret_scanning_push_protection") then .security_and_analysis.secret_scanning_push_protection.status else "unavailable" end' \
  2>/dev/null || echo unavailable)
if [[ "$SS" == "enabled" && "$SSPP" == "enabled" ]]; then
  pass "secret scanning and push protection enabled"
elif [[ "$PRIVATE" == "true" && "$SS" == "unavailable" ]]; then
  skip "secret scanning + push protection" "not available on this plan — needs GitHub Secret Protection"
elif [[ "$CHECK" -eq 1 ]]; then
  fail "secret scanning is ${SS}, push protection is ${SSPP}"
else
  if gh api -X PATCH "repos/$REPO" --input - >/dev/null 2>&1 <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
  then
    pass "enabled secret scanning and push protection"
  else
    fail "could not enable secret scanning"
  fi
fi

# 6. Private vulnerability reporting (public repos only) -------------------------
step 6 "Private vulnerability reporting"
if [[ "$PRIVATE" == "true" ]]; then
  skip "private vulnerability reporting" "public repos only — use the SECURITY.md email contact"
else
  PVR=$(gh api "repos/$REPO/private-vulnerability-reporting" --jq .enabled 2>/dev/null || echo "")
  if [[ "$PVR" == "true" ]]; then
    pass "private vulnerability reporting enabled"
  elif [[ "$CHECK" -eq 1 ]]; then
    fail "private vulnerability reporting disabled"
  else
    gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null
    pass "enabled private vulnerability reporting"
  fi
fi

# 7. Dependabot alerts ------------------------------------------------------------
step 7 "Dependabot vulnerability alerts"
if gh api "repos/$REPO/vulnerability-alerts" >/dev/null 2>&1; then
  pass "Dependabot alerts enabled"
elif [[ "$CHECK" -eq 1 ]]; then
  fail "Dependabot alerts disabled"
else
  gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null
  pass "enabled Dependabot alerts"
fi

# 8. Actions allowlist -------------------------------------------------------------
step 8 "Actions allowlist (GitHub-owned + verified + explicit patterns)"
ALLOWED_PATTERNS=("zizmorcore/*" "SocketDev/*")
if [[ -n "$EXTRA_PATTERNS" ]]; then
  IFS=',' read -ra _pats <<<"$EXTRA_PATTERNS"
  for p in "${_pats[@]}"; do
    p="${p# }"; p="${p% }"
    [[ -n "$p" ]] && ALLOWED_PATTERNS+=("$p")
  done
fi
PATTERNS_JSON=$(printf '"%s",' "${ALLOWED_PATTERNS[@]}")
PATTERNS_JSON="${PATTERNS_JSON%,}"

AA_MODE=$(gh api "repos/$REPO/actions/permissions" --jq '.allowed_actions // ""' 2>/dev/null || echo "")
allowlist_covers() { # every wanted pattern present in the current selected-actions config
  local have p
  have=$(gh api "repos/$REPO/actions/permissions/selected-actions" \
    --jq '(.patterns_allowed // []) | join(",")' 2>/dev/null || echo "")
  gh api "repos/$REPO/actions/permissions/selected-actions" --jq .github_owned_allowed 2>/dev/null \
    | grep -q true || return 1
  for p in "${ALLOWED_PATTERNS[@]}"; do
    grep -qF ",$p," <<<",$have," || return 1
  done
}
if [[ "$AA_MODE" == "selected" ]] && allowlist_covers; then
  pass "only GitHub-owned, verified, and allowlisted actions can run (${ALLOWED_PATTERNS[*]})"
elif [[ "$CHECK" -eq 1 ]]; then
  fail "allowed_actions is ${AA_MODE:-all} or the allowlist is missing patterns (want: ${ALLOWED_PATTERNS[*]})"
else
  if gh api -X PUT "repos/$REPO/actions/permissions" -F enabled=true -f allowed_actions=selected >/dev/null 2>&1 &&
     printf '{ "github_owned_allowed": true, "verified_allowed": true, "patterns_allowed": [%s] }' "$PATTERNS_JSON" |
       gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --input - >/dev/null 2>&1; then
    pass "allowlist set: GitHub-owned + verified + ${ALLOWED_PATTERNS[*]}"
    echo "    note: any workflow using an action outside this list will fail — grep 'uses:' in"
    echo "    .github/workflows and re-run with --allowed-actions \"owner/*,...\" to extend."
  else
    fail "could not set the Actions allowlist (an org-level policy may control it)"
  fi
fi

# ---------------------------------------------------------------------------------
echo
if [[ "$CHECK" -eq 1 ]]; then
  if [[ "$FAILS" -gt 0 ]]; then
    echo "Audit: $FAILS setting(s) not in the desired state."
    exit 1
  fi
  echo "Audit: all applicable settings are in the desired state."
else
  echo "Done. Settings GitHub cannot script — configure these on npmjs.com (npm libraries only):"
  echo "  · Trusted publishing (OIDC) configured STAGE-ONLY — the publisher can stage, never publish live"
  echo "  · Staged publishing: CI runs 'npm stage publish'; a maintainer promotes with 2FA"
  echo "  · Package access: require 2FA and disallow tokens (no direct publish rights)"
  echo "  · Connect Drydock (https://drydock.org) to review staged releases before promotion"
  [[ "$FAILS" -gt 0 ]] && { echo; echo "warning: $FAILS setting(s) could not be applied — see above."; exit 1; }
fi
