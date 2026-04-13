# Projects

Projects are the unit of organization inside a workspace. Each project has its own issues, states, categories, sprints, labels, events, and members. A workspace can hold any number of projects.

## Creating a project

Click the **+** button next to **PROJECTS** in the sidebar, or open the workspace home and use the **Create project** button. You will see this dialog:

![Create project dialog](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/05-project-create.png)

Fill in:

- **Project Name** — shown everywhere in the app.
- **Identifier** — a short uppercase code used as a prefix for issue IDs (e.g. `AUR` produces `AUR-1`, `AUR-2`…). Cannot be changed later.
- **Project Lead** — a workspace member who is the primary point of contact. Defaults to you.
- **Visibility**
  - **Private** — only members you explicitly invite can see it.
  - **Public** — visible to every workspace member. Non-members can browse the project through **Discover** and join when they want.
- **Description** — optional context.
- **Members** — people to invite at creation time. You can always add more later.

A brand new project ships with five default states (Backlog, Todo, In Progress, Done, Cancelled) which you can customize in **Workspace settings → States**.

## Project members and granular permissions

Every project has its own member list, which is a subset of the workspace. Open **Workspace settings → Members** from inside a project to manage it.

![Project members and permissions](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/05-project-members.png)

Each member has a **role**:

- **Admin** — can do everything, including adding and removing members.
- **Member** — can work in the project, subject to the granular flags below.
- **Viewer** — read-only. Can see the project but cannot make changes.

Below the member list is the **Granular permissions** matrix. For every non-Admin member you can independently allow or deny:

- **Edit** — modifying issue fields, inline editing, bulk actions.
- **Archive** — archiving issues or the project itself.
- **Trash** — soft-deleting issues.
- **Purge** — permanently deleting issues from the trash.

Admins automatically have every flag regardless of what the checkboxes show.

## Archiving projects

Projects you are done with (but don't want to lose) can be archived. An archived project is hidden from the main sidebar but still reachable through **Archived** at the top of the sidebar.

![Archived projects](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/05-archived-projects.png)

Each archived project shows a **Restore** button that brings it back into the active list with all its issues and history intact. Archiving is a completely reversible soft-delete — nothing is ever erased this way.
