---
name: fh-lab-results
description: Query Function Health lab results, check for new data, compare visits, and deep-dive on biomarkers. Use when the user asks about labs, bloodwork, biomarkers, or health markers.
argument-hint: "[summary | check | sync | biomarker <name> | changes | out-of-range | category <name>]"
allowed-tools: mcp__function-health__fh_login, mcp__function-health__fh_status, mcp__function-health__fh_results, mcp__function-health__fh_biomarker, mcp__function-health__fh_summary, mcp__function-health__fh_categories, mcp__function-health__fh_changes, mcp__function-health__fh_sync, mcp__function-health__fh_check, mcp__function-health__fh_recommendations, mcp__function-health__fh_report, mcp__function-health__fh_version, mcp__function-health__fh_notifications
---

# Lab Results Skill

Query and analyze Function Health lab results. This skill wraps 13 MCP tools for a conversational lab results experience.

## First-Time Setup (Onboarding)

**Always start by calling `fh_status` to check if the user is authenticated and has data.**

If `authenticated` is false:
1. Tell the user they need to connect their Function Health account
2. Instruct them to run `npx -y -p function-health-mcp function-health login` in their terminal (this keeps their password secure with hidden input)
3. Once they confirm they've logged in, run `fh_sync` to pull their data
4. Then proceed with the requested action (or show a summary)

If `authenticated` is true but `hasData` is false:
1. Run `fh_sync` to pull data
2. Then proceed with the requested action

If `tokenValid` is false (expired session):
1. Check the `authHint` field in the status response for guidance
2. If `FH_EMAIL` and `FH_PASSWORD` env vars are set, auto-login will be attempted on the next API call — just retry the operation
3. Otherwise, instruct the user to run `npx -y -p function-health-mcp function-health login` in their terminal
4. Mention they can set `FH_EMAIL` and `FH_PASSWORD` environment variables for hands-free re-authentication

## When to use

Trigger when the user mentions:
- Lab results, bloodwork, biomarkers, health markers
- Specific biomarker names (e.g., "vitamin D", "testosterone", "A1C")
- Checking for new results or syncing data
- Comparing visits or tracking changes
- Health summary or out-of-range markers

## Arguments

Parse from $ARGUMENTS:

| Argument | Action |
|----------|--------|
| `summary` or no args | Health summary (default) |
| `check` | Lightweight check for new results |
| `sync` | Pull latest data from Function Health |
| `biomarker <name>` | Deep dive on a specific biomarker |
| `changes` | Compare last two test rounds |
| `out-of-range` | Show all out-of-range markers |
| `category <name>` | Show results for a category (e.g., "heart", "thyroid") |
| `recommendations` | Show health recommendations |
| `report` | Show clinician report |

## Workflows

### Default: Health Summary

1. Call `fh_summary`
2. Present conversationally:
   - Total markers tested, how many in/out of range
   - Biological age vs chronological age (if available)
   - BMI (if available)
   - List out-of-range markers with values
3. If there are out-of-range markers, offer to deep-dive on any of them

### Check for New Results

1. Call `fh_check`
2. Report pending/completed requisitions and last sync time
3. If `newResultsAvailable` is true, ask if user wants to sync

### Sync

1. Call `fh_sync`
2. Report how many results were pulled and if there are new ones
3. If new results found, automatically run a changes comparison

### Biomarker Deep Dive

1. Call `fh_biomarker` with the name
2. Present:
   - Current value and whether it's in range
   - Optimal range
   - History across all visits (show trend direction)
   - Why it matters (clinical context)
   - Recommendations (foods, supplements, lifestyle)
3. Keep it conversational — lead with the number, then context

### Daily Briefing

For daily review / morning briefing, include a Function Health section:

1. Call `fh_notifications` (without acknowledge) to check for pending changes
2. If no notifications → report "No new lab data" and move on
3. If there are notifications, present them:
   - Lead with what's significant: worsened markers, biological age changes
   - Then improvements and new results
   - For new results, automatically call `fh_changes` to compare against previous rounds of the same tests — show how values moved
   - For any newly out-of-range marker, call `fh_biomarker` to get context and recommendations
4. After presenting everything, call `fh_notifications` with `acknowledge: true` to clear

This ensures the user gets a complete picture without needing to ask follow-up questions.

**Example output:**
> **Function Health:** New lab results came in yesterday. 3 new results — Vitamin D improved to 42 (was 28, now in range), A1C steady at 5.4. LDL moved out of range at 142 (was 128). I'd recommend focusing on the LDL — here are the dietary recommendations...

### Compare Test Rounds

1. Call `fh_changes`
2. Each test round includes all lab visits (1-3) over several weeks. Comparisons are between complete rounds, not individual visit dates.
3. Summarize by category:
   - Improved markers (moved into range)
   - Worsened markers (moved out of range)
   - Significantly changed (>10% delta)
   - New markers (first time tested)
4. Lead with wins, then concerns

### Out-of-Range Review

1. Call `fh_results` with `status: "out_of_range"`
2. Group by severity or category if many results
3. For each, show name and value
4. Offer to deep-dive on specific markers

### Category View

1. Call `fh_results` with the category name
2. Show all markers in that category with values and status
3. Highlight any out-of-range

## Presentation Style

- **Conversational, not clinical.** "Your Vitamin D is at 28 — a bit below optimal (40-60). It's been trending up though, from 22 last visit."
- **Lead with what matters.** Out-of-range first, then context.
- **Use specific numbers.** "72 out of 78 markers in range" not "most markers look good."
- **Show trends when available.** "Up from 145 → 162 since last visit."
- **Offer next steps.** After showing out-of-range, offer to deep-dive. After showing a biomarker, mention if there are recommendations.

## Periodic Monitoring

Change notifications persist across conversations — missed days don't lose data. New lab results from Function Health typically arrive in batches over several weeks as different panels complete. The daily briefing workflow (above) is one way to surface these; alternatively, just run `/fh-lab-results check` periodically.
