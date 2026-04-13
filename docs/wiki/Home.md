# OrbiTail

**English** · [한국어](한국어)

OrbiTail is a self-hosted project management tool that combines a Linear-style issue tracker with a shared team calendar and a Gantt-style timeline. It runs on your own infrastructure via Docker Compose.

![Dashboard overview](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/01-dashboard-overview.png?v=2)

## User Guide

- **[Getting Started](Getting-Started)** — your first look at the dashboard, sidebar, and top bar
- **[Issues](Issues)** — tracking work in the table view, bulk editing, issue details
- **[Calendar](Calendar)** — team events, participants, "My schedule" filter
- **[Timeline](Timeline)** — roadmap view with dynamic scale and settings
- **[Projects](Projects)** — creating projects, members, granular permissions, archiving
- **[Announcements](Announcements)** — release notes and broadcast notices
- **[Profile](Profile)** — personal settings and preferences

## About the screenshots

Every screenshot in this wiki is taken against the **Nimbus Studio** demo workspace — a fictional mobile studio with three projects (Aurora, Meteor, Archive 2025) and six members. You can recreate the exact same state on your own machine:

```bash
docker compose exec backend python manage.py seed_demo
```

Then log in with any demo account:

| Email                    | Role    |
|--------------------------|---------|
| `daniel@nimbus.studio`   | Owner   |
| `sarah@nimbus.studio`    | Admin   |
| `jake@nimbus.studio`     | Member  |
| `yuna@nimbus.studio`     | Member  |
| `minjae@nimbus.studio`   | Viewer  |
| `sophie@nimbus.studio`   | Member  |

Password for all demo users: `nimbus1234!`
