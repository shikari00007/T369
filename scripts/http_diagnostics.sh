#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
TS="$(date +%Y%m%d%H%M%S)"
PERSONAL_TITLE="P-${TS}"
PRO_TITLE="PR-${TS}"

print_header() {
  echo
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

pretty_print_json() {
  if command -v jq >/dev/null 2>&1; then
    jq .
  else
    cat
  fi
}

request_json() {
  local label="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"

  print_header "$label"
  echo "REQUEST: ${method} ${url}"

  if [[ -n "$body" ]]; then
    echo "BODY: $body"
    response="$(curl -sS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body")"
  else
    response="$(curl -sS -X "$method" "$url")"
  fi

  echo "RESPONSE:"
  echo "$response" | pretty_print_json
}

request_text() {
  local label="$1"
  local method="$2"
  local url="$3"

  print_header "$label"
  echo "REQUEST: ${method} ${url}"
  response="$(curl -sS -X "$method" "$url")"
  echo "RESPONSE:"
  echo "$response"
}

extract_first_category_id() {
  local dashboard_json="$1"
  local id

  if command -v jq >/dev/null 2>&1; then
    id="$(echo "$dashboard_json" | jq -r '.categories[0].id // empty')"
  else
    id="$(echo "$dashboard_json" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p' | head -n 1)"
  fi

  if [[ -z "$id" ]]; then
    id="1"
  fi

  echo "$id"
}

print_header "TASK369 HTTP DIAGNOSTICS"
echo "BASE_URL: $BASE_URL"
echo "TIMESTAMP: $TS"

request_json "HEALTH CHECK" "GET" "$BASE_URL/health"

DASHBOARD_RAW="$(curl -sS "$BASE_URL/api/dashboard")"
print_header "DASHBOARD"
echo "$DASHBOARD_RAW" | pretty_print_json

CATEGORY_ID="$(extract_first_category_id "$DASHBOARD_RAW")"
print_header "DERIVED CATEGORY"
echo "CATEGORY_ID=$CATEGORY_ID"

request_json "PLANNER (NEW ENDPOINT)" "GET" "$BASE_URL/api/life-category/planner?date=$(date +%F)"

print_header "PLANNER (LEGACY ENDPOINT CHECK)"
echo "REQUEST: GET $BASE_URL/api/planner?date=$(date +%F)"
set +e
LEGACY_PLANNER_RESPONSE="$(curl -sS "$BASE_URL/api/planner?date=$(date +%F)" 2>&1)"
LEGACY_PLANNER_EXIT=$?
set -e
echo "EXIT_CODE: $LEGACY_PLANNER_EXIT"
echo "RESPONSE:"
echo "$LEGACY_PLANNER_RESPONSE"

PERSONAL_BODY="{\"task_type\":\"personal\",\"title\":\"${PERSONAL_TITLE}\",\"description\":\"http diagnostics personal\",\"severity\":\"medium\",\"status\":\"pending\",\"category_id\":${CATEGORY_ID},\"due_date\":null,\"due_time\":null,\"notes\":\"\"}"
PRO_BODY="{\"task_type\":\"professional\",\"title\":\"${PRO_TITLE}\",\"description\":\"http diagnostics professional\",\"project_name\":\"Ops\",\"severity\":\"high\",\"status\":\"pending\",\"assigned_to\":null,\"due_date\":null,\"due_time\":null,\"notes\":\"\"}"

request_json "CREATE PERSONAL TASK" "POST" "$BASE_URL/api/tasks" "$PERSONAL_BODY"
request_json "CREATE PROFESSIONAL TASK" "POST" "$BASE_URL/api/tasks" "$PRO_BODY"

request_json "LIST PERSONAL TASKS" "GET" "$BASE_URL/api/tasks?task_type=personal"
request_json "LIST PROFESSIONAL TASKS" "GET" "$BASE_URL/api/tasks?task_type=professional"

request_json "SEARCH PERSONAL TASK (TIMESTAMP)" "GET" "$BASE_URL/api/tasks?task_type=personal&q=$TS"
request_json "SEARCH PROFESSIONAL TASK (TIMESTAMP)" "GET" "$BASE_URL/api/tasks?task_type=professional&q=$TS"
request_json "SEARCH PROFESSIONAL TASK (OPS KEYWORD)" "GET" "$BASE_URL/api/tasks?task_type=professional&q=ops"

request_json "COMPLETED TASKS" "GET" "$BASE_URL/api/completed-tasks"
request_json "TEAM MEMBERS" "GET" "$BASE_URL/api/team-members"
request_json "VACATIONS" "GET" "$BASE_URL/api/vacations"
request_json "REASSIGNMENTS" "GET" "$BASE_URL/api/reassignments"
request_json "FOCUS SESSIONS" "GET" "$BASE_URL/api/focus-sessions"

APP_JS="$(curl -sS "$BASE_URL/app.js")"
print_header "APP.JS MARKERS"
for marker in "resetTaskSearchAndFilters" "/api/life-category/planner" "dashboardTaskSearch" "/api/completed-tasks"; do
  if echo "$APP_JS" | grep -q "$marker"; then
    echo "FOUND: $marker"
  else
    echo "MISSING: $marker"
  fi
done

print_header "DONE"
echo "Share this full output in chat."