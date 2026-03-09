---
name: lab-results
description: Query Function Health lab results, check for new data, compare visits, and deep-dive on biomarkers. Use when the user asks about labs, bloodwork, biomarkers, or health markers.
argument-hint: "[summary | check | sync | biomarker <name> | changes | out-of-range | category <name>]"
allowed-tools: mcp__function-health__function_health_login, mcp__function-health__function_health_status, mcp__function-health__function_health_results, mcp__function-health__function_health_biomarker, mcp__function-health__function_health_summary, mcp__function-health__function_health_categories, mcp__function-health__function_health_changes, mcp__function-health__function_health_sync, mcp__function-health__function_health_check, mcp__function-health__function_health_recommendations, mcp__function-health__function_health_report
---

# Lab Results Skill

Query and analyze Function Health lab results. This skill wraps 11 MCP tools for a conversational lab results experience.

## First-Time Setup (Onboarding)

**Always start by calling `function_health_status` to check if the user is authenticated and has data.**

If `authenticated` is false:
1. Tell the user they need to connect their Function Health account
2. Ask for their Function Health email and password
3. Call `function_health_login` with their credentials
4. On success, automatically run `function_health_sync` to pull their data
5. Then proceed with the requested action (or show a summary)

If `authenticated` is true but `hasData` is false:
1. Run `function_health_sync` to pull data
2. Then proceed with the requested action

If `tokenValid` is false (expired session):
1. Ask the user to re-authenticate with `function_health_login`

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
| `changes` | Compare last two visits |
| `out-of-range` | Show all out-of-range markers |
| `category <name>` | Show results for a category (e.g., "heart", "thyroid") |
| `recommendations` | Show health recommendations |
| `report` | Show clinician report |

## Workflows

### Default: Health Summary

1. Call `function_health_summary`
2. Present conversationally:
   - Total markers tested, how many in/out of range
   - Biological age vs chronological age (if available)
   - BMI (if available)
   - List out-of-range markers with values
3. If there are out-of-range markers, offer to deep-dive on any of them

### Check for New Results

1. Call `function_health_check`
2. Report pending/completed requisitions and last sync time
3. If `newResultsAvailable` is true, ask if user wants to sync

### Sync

1. Call `function_health_sync`
2. Report how many results were pulled and if there are new ones
3. If new results found, automatically run a changes comparison

### Biomarker Deep Dive

1. Call `function_health_biomarker` with the name
2. Present:
   - Current value and whether it's in range
   - Optimal range
   - History across all visits (show trend direction)
   - Why it matters (clinical context)
   - Recommendations (foods, supplements, lifestyle)
3. Keep it conversational — lead with the number, then context

### Compare Visits

1. Call `function_health_changes`
2. Summarize by category:
   - Improved markers (moved into range)
   - Worsened markers (moved out of range)
   - Significantly changed (>10% delta)
   - New markers (first time tested)
3. Lead with wins, then concerns

### Out-of-Range Review

1. Call `function_health_results` with `status: "out_of_range"`
2. Group by severity or category if many results
3. For each, show name and value
4. Offer to deep-dive on specific markers

### Category View

1. Call `function_health_results` with the category name
2. Show all markers in that category with values and status
3. Highlight any out-of-range

## Presentation Style

- **Conversational, not clinical.** "Your Vitamin D is at 28 — a bit below optimal (40-60). It's been trending up though, from 22 last visit."
- **Lead with what matters.** Out-of-range first, then context.
- **Use specific numbers.** "72 out of 78 markers in range" not "most markers look good."
- **Show trends when available.** "Up from 145 → 162 since last visit."
- **Offer next steps.** After showing out-of-range, offer to deep-dive. After showing a biomarker, mention if there are recommendations.

## Periodic Monitoring

This skill works with `/loop` for automatic checking:

```
/loop 6h /lab-results check
```

When new results are detected:
1. `function_health_check` returns `newResultsAvailable: true`
2. Automatically run `function_health_sync`
3. Run `function_health_changes` to compare with previous visit
4. Present the changes summary conversationally
