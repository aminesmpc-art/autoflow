# Director Chief Node

## Goal
Add a runnable Director Chief node that turns one brief into a locked global story bible and delegates bounded scene groups to directly connected Director nodes.

## Tasks
- [x] Define and test the Chief prompt, child discovery, reply parser, and missing-assignment errors.
- [x] Register the new node’s ports, component, toolbar button, documentation, and runnable capability.
- [x] Execute the Chief before its child Directors, distribute one brief per child, and lock inherited global settings.
- [x] Extend builder-plan support and quality checks for Chief-controlled multi-Director workflows.
- [x] Upgrade the Wrong Room template and standalone builder JSON to use the hierarchy.
- [x] Run focused tests, TypeScript/build validation, and diff checks.

## Done When
- [x] `Brief → Director Chief → Directors → generators` runs in topological order.
- [x] Every connected Director receives exactly its own assignment and shared identity bible.
- [x] Missing or malformed Chief assignments fail before generation and are retried at most twice.
- [x] The child Directors’ existing validator performs targeted prompt repairs within each group.
