# Announcements

**English** · [한국어](공지사항)

The Announcements page is OrbiTail's built-in channel for **release notes** and **broadcast notices**. Every workspace user sees the same feed, and new items trigger an unread dot on the **Announcements** sidebar item until you open the page.

![Announcements list](https://raw.githubusercontent.com/ruripian/OrbiTail/main/docs/wiki-screenshots/08-announcements-list.png?v=2)

Each card shows the **category** (Feature, Improvement, Bugfix, Notice), the optional **version tag**, the **title**, the **publish date**, and a short body. Categories are color-coded so you can skim for what matters to you.

## Creating announcements

Only **staff** users can create announcements. If you are a staff user, a **New announcement** button appears in the top right of the page, and each card gains edit and delete actions. Announcements support full markdown in the body, so you can embed code, lists, and links.

Use them for:

- **Release notes** — tag with a version like `v0.1.0` and category `Feature` when shipping new functionality.
- **Incident notices** — category `Notice` for maintenance windows, service degradation, rollouts.
- **Bug fixes** — category `Bugfix` with a short summary so users know what to look for.

## How unread works

Every user tracks the latest announcement they have seen. Any announcement published after that point shows up as unread with a dot next to the **Announcements** sidebar item. Opening the page marks everything as read.
