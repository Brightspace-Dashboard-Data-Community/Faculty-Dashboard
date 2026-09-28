# Changelog

Product history for the Faculty Dashboard. This file lives in the working copy. Running `python3 scripts/prepare-github-upload.py` copies it into `github-upload/`, which is the folder to commit and push.

Add new entries at the top. The prepare script does not invent history; it only publishes what is written here, plus a fresh `EXPORT-NOTES.md` describing what was removed for the public copy.

## 2026-09-28

First recorded public snapshot.

The Faculty Dashboard is a multi-page Brightspace site that runs in the instructor's browser. Faculty use it for course operations, student follow-up, analytics, accessibility, and training without a separate application server.

### In this snapshot

- Shared navigation and home, plus My Courses, Students, Analytics, Resources, Faculty Training, Accessibility, Tools, Forms, and Updates
- Course tools: sandbox course, course-merge forms, package deployer, due-date wizard, bulk editors (availability, discussions, gradebook, announcements), private student conversations, Intelligent Agent builder, term rollover assistant, grade export, end-of-semester report, and semester rollover kit
- Student tools: learner accommodations, student LDAA lookup, and inactive-student audit
- Engagement, discussion-tone, and feedback-tone engines, plus the office-hours widget
- Accessibility guides, YuJa Panorama notes, and the Simple Syllabus tutorial
- Semester reminder and syllabus-update mini-apps
- Downloadable Brightspace tutorial documents

### Left out of the public folder

- `non-essential/` (experiments, archives, and local tooling)
- The internal continuity document
- Discussion-export planning notes

See `EXPORT-NOTES.md` in the public folder for accounts, live links, screenshots, and branding removed from that copy.
