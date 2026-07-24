# Taste Profile
- Verifies changes with `npx tsc --noEmit` after structural edits. Confidence: 0.8
- Evaluates and plans before implementing — explore codebase, understand patterns, then write a plan. Confidence: 0.85
- Prioritizes accessibility: moves actions to bar control when they only exist on start page, so they're reachable during calls. Confidence: 0.9
- Integrates into existing UI patterns (e.g., "more" dropdown) rather than creating new UI elements. Confidence: 0.85
- Uses conditional rendering based on auth/user state (e.g., Account item only when user exists, Sign out vs Sign in toggle). Confidence: 0.8
- Extracts duplicated/inline SVGs into a shared `icons` module for reuse across components. Confidence: 0.9
- Prefers mutual friend relationships over one-way follows, since friends are needed for group matching features. Confidence: 0.9
- Implements new social features across both backend and frontend together (full-stack). Confidence: 0.85
