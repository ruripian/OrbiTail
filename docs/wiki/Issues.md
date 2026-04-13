# Issues

**English** · [한국어](이슈)

Issues are the unit of work in OrbiTail. Each one has a title, a state, a priority, an assignee, dates, labels, and an optional parent issue. A project's issues can be viewed as a **Table**, a **Board**, a **Calendar**, a **Timeline**, or as **Sprints** — this page focuses on the Table view, which is the default.

## Table view

Open any project and click **Issues** in the sidebar to land on the table.

![Table view](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-table-view.png)

Each row is an issue, rendered as a card with the ID, title, state, priority, assignee, start date, due date, and labels. You can:

- **Drag columns** to reorder them.
- **Resize columns** by dragging the thin separator between any two column headers.
- **Show or hide columns** from the **Columns** button on the right of the filter bar.
- **Drag a row onto another row** to nest it as a sub-issue, or drag it between rows to reorder.

## Filtering

The filter bar above the table lets you narrow the list by status, priority, assignee, label, and more. Open any filter chip to pick values.

![Filter dropdown](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-table-filters.png)

Filters are combined with AND — an issue must match every active filter to appear. The counter at the top right of the page updates live to show how many issues match.

## Inline editing

Every cell in the table is a picker. Click directly on a state, priority, assignee, or date and OrbiTail opens an inline dropdown right where you clicked.

![Inline state picker](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-table-inline-edit.png)

Pick a new value and the row saves immediately. Press **Cmd/Ctrl + Z** anywhere in the app to undo the change — the undo stack captures previous values from inline edits and from bulk actions.

## Bulk actions

Select multiple issues using the checkboxes on the left of each row. As soon as you have at least one selection, a **bulk toolbar** appears at the bottom of the page.

![Bulk toolbar](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-table-bulk-edit.png)

From the toolbar you can:

- **Change State** — move every selected issue to the same state.
- **Change Priority** — set priority in one click.
- **Change Assignee** — reassign every selected issue.
- **Delete** — send all selected issues to the trash.
- **Deselect** — clear the selection.

Bulk changes are also undoable with **Cmd/Ctrl + Z**.

## Creating a new issue

Click **+ Add issue** in the top right of the table, or use the keyboard shortcut **C**.

![Create issue dialog](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-issue-create.png)

Fill in the title (required), and optionally set priority, status, assignees, dates, category, and sprint. The status defaults to your project's default state. Click **Create issue** to save.

## The issue detail page

Click any issue title in the table to open its detail page. This is where you add rich-text descriptions, sub-issues, links, attachments, and comments.

![Issue detail](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/02-issue-detail.png)

The right-hand side holds all the editable fields (state, priority, assignees, category, sprint, dates, labels, parent) and the primary actions:

- **Copy** — duplicate the issue, including its sub-issues.
- **Archive** — move to the archive (reversible).
- **Delete issue** — soft delete to the trash. A toast with an **Undo** button appears at the bottom of the screen and stays there for eight seconds.

Sub-issues, links, attachments, comments, and the activity feed each live in their own tab at the top of the detail pane.
