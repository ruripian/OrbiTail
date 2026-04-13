# Timeline

**English** · [한국어](타임라인)

The Timeline view is OrbiTail's roadmap — a Gantt-style chart that plots every dated issue and event against a continuous horizontal time axis. It is the best place to spot overlap, slack, and long-running work across a project.

![Timeline overview](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/04-timeline-overview.png?v=2)

Each row is an issue. The colored bar spans from its start date to its due date. Issues with only one date render as a single-day bar so they are still visible. Hover a bar to see the full title in a tooltip, and click it to jump to the issue detail page.

The vertical yellow line marks **today**, and it stays locked to the current day as you scroll. A dim bar behind each row is the sprint the issue belongs to, giving you context at a glance.

## Scale and scrolling

Above the grid you have three scale buttons — **Day**, **Week**, **Month**. Switching the scale keeps the currently visible portion of the timeline centered, so you never lose your place. Drag horizontally inside the grid to scrub through time.

Rows group automatically by **Category** (Design, Engineering, QA…) so related work stays together.

## Timeline settings

Open the **Settings** button in the top right for filters and display options.

![Timeline settings](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/04-timeline-settings.png?v=2)

The settings panel lets you:

- **Pick a default scale** — Day, Week, or Month.
- **Group rows** by Assignee, None, Status, Priority, Category, or Sprint.
- **Show completed issues** — off by default so the roadmap stays focused on what's still in flight.
- **Show issues without dates** — if you want to audit unscheduled work.
- **Hide weekends** — useful for pure working-day planning.
- **Show events** — overlay calendar events as their own row group at the top of the timeline.

Settings are saved per user, so your preferences stick around between sessions.
