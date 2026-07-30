# Project Plan

> A practical workspace for shipping the next version without losing the thread.
>
> Review this at the start of each week and move finished work into the release note.

## Outcome

Launch a calmer, faster notes experience for the team by **October 18**. The first release should make it easy to capture work, find it again, and share a clear project update.

## This week

- [x] Confirm the release outcome and success measures
- [x] Create a first-pass information architecture
- [ ] Build the folder navigation
  - [x] List actual folders from disk
  - [ ] Add drag-and-drop note moves
- [ ] Polish the editing flow
  - [ ] Check selection toolbar behavior
  - [ ] Test task checkboxes in preview
- [ ] Write the launch update

## Milestones

| Milestone | Owner | Target | Status |
| --- | --- | --- | --- |
| Workspace foundation | Maya | Sep 20 | Complete |
| Editing polish | Leo | Sep 27 | In progress |
| Team pilot | Ana | Oct 4 | Planned |
| Launch | Maya | Oct 18 | Planned |

## Decisions

1. Folders are the source of truth, because users should recognize their files in Finder and Explorer.
2. The top heading is the note title and the filename.
3. Preview is interactive for simple tasks, so planning does not require switching modes.

## Useful links

- [[Meeting Notes — Kickoff]]
- [[Weekly Review]]
- [[Release Checklist]]
- [[Ideas Backlog]]

## Small implementation note

```ts
const nextStep = tasks.find((task) => !task.complete);

if (nextStep) {
  focus(nextStep);
}
```
