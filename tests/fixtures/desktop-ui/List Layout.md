---
tags: [ui-check, lists]
---
# List Layout

## Mixed bullets and tasks

- [A long descriptive link whose label should wrap naturally over multiple lines without moving its bullet](https://example.com)
- Plain bullet with **bold text**, _emphasis_, ~~strikethrough~~, and `inline code` that continues for enough words to wrap across the available width.
- [ ] Task with a long description and [a descriptive link](https://example.com) that should align on every wrapped line.
  - A nested bullet under the task, with enough text to wrap to a second line and stay indented.
  - [x] Nested task with a description long enough to wrap across several lines in a narrow preview pane.
  - A sibling bullet after the nested task.
    - A third level of ordinary bullets.
- [x] Completed task
- A final ordinary bullet beside the tasks.

## Loose tasks and paragraphs

- [ ] Loose task with **bold** text that continues across a narrow preview pane and wraps onto multiple lines.

  A second paragraph belonging to the same task.

  - Nested bullet under a loose task.
  - [ ] Nested task with a long description that should wrap without moving its checkbox.

- Another ordinary bullet next to a task.

## Numbered lists

9. [ ] Numbered task with a description that should wrap across a narrow preview pane.
10. [A long numbered link whose label should wrap without moving the number](https://example.com)
11. Ordinary numbered item
    1. Nested numbered child
    2. [ ] Nested numbered task

## Quoted tasks

> - [ ] A quoted task with enough text to wrap and with a [link](https://example.com).
>   - A nested quoted bullet.
> - Another quoted bullet next to the task.

## Hard line break

- First line with a deliberate break.\
  Continuation text should remain aligned with the first line.

See [[Long Links]] and [[Rich Content]].
