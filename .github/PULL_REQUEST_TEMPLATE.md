## What and why

<!-- What does this change, and why? Link the issue: "Fixes #123". -->

## How it was tested

<!-- The tests you added or changed, and anything you checked by hand. If it is a claim about an agent, which version of the binary you put it to. -->

## Checklist

- [ ] `npm test` passes, and the change has a test
- [ ] No new dependencies
- [ ] Tests use a temporary folder, never real user data, and any agent binary starts behind the guard of `test/sandbox.mjs`
- [ ] Token cost: unchanged (the tool runs outside every agent), or stated here and in the README's "What it costs in tokens"
- [ ] README and CHANGELOG updated where they describe what changed
