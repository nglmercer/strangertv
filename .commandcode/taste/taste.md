# Taste Profile

## Workflow
- Verifies changes with `npx tsc --noEmit` after structural edits. Confidence: 0.8

## Preferences
- Prioritizes accessibility: moves actions to bar control when they only exist on start page, so they're reachable during calls. Confidence: 0.9
- Integrates into existing UI patterns (e.g., "more" dropdown) rather than creating new UI elements. Confidence: 0.85
- Uses conditional rendering based on auth/user state (e.g., Account item only when user exists, Sign out vs Sign in toggle). Confidence: 0.8
