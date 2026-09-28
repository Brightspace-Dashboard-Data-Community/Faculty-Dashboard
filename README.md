# Faculty Dashboard

Browser-based Brightspace faculty dashboard for course tools, student insights, analytics, and training. Pages run in the instructor's browser and call Brightspace with the signed-in session. This repository does not include student records.

Values that identify a single college are placeholders in this copy:

- Brightspace host: root-relative `/d2l/...` paths, or `your-brightspace.example.edu` where a full host is required
- Email domain: `example.edu`
- Organization name: Your Institution
- Term org unit IDs in `js/semester-config.js`: `null`
- Sandbox template and semester IDs in `sandbox-course.html`: `0`
- ReadSpeaker customer ID: `00000`

Replace those placeholders before deploying. Also set the coming-soon allowlist in `js/coming-soon-modal.js`, help desk and form links, instructor and student role IDs, and `assets/institution-mark.svg`.

Do not add live user exports, staff directories, screen recordings, or signed-in Brightspace screenshots to this repository. Screenshots that showed a signed-in session were removed. Those spots use `screenshot-omitted.svg`.

See `CHANGELOG.md` for product history and `EXPORT-NOTES.md` for what was removed from this copy.
