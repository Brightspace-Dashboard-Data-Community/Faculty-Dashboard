# Changelog

Product history for the Faculty Dashboard. This file lives in the working copy. Running `python3 scripts/prepare-github-upload.py` copies it into `github-upload/`, which is the folder to commit and push.

Add new entries at the top. The prepare script does not invent history; it only publishes what is written here, plus a fresh `EXPORT-NOTES.md` describing what was removed for the public copy.

## 2026-09-29

Student LDAA reports now list every activity row, and content-module visits come from the Brightspace Content statistics page. The same reader is used where other tools were missing visit dates.

Content views stay informational. They are not part of the faculty-withdrawal date or the LDAA Period Report.

### Student LDAA Lookup

- Discussion posts, assignments, and quiz attempts are listed in full on the page and in the PDF. Long titles wrap instead of being cut off.
- The date callout tells faculty to use it when they submit a faculty withdrawal and when they assign a final grade of F.
- Content module access is read from the Content statistics page for that student: module totals, topic visits, average time, and last visit. Course login and content views are labeled as not counted toward Last Date of Academic Activity.

### Content statistics in other tools

- The end-of-semester report uses that same page for class topic visit rates, including which topics few students opened and which topics students actually used.
- The engagement engine student calendar shows each content topic’s last visit.
- Inactive Student Audit adds a last content visit column. The inactivity flag is still course login, not content views.

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
