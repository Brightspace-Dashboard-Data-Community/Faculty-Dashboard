# Export notes

Prepared 2026-09-29 for GitHub upload.

The working Faculty Dashboard was not modified. This folder is a sanitized copy.
Files copied: 186.

## Left out entirely

- `non-essential/` (experiments, archives, node modules, and local tooling)
- `discussion-text-export-planning/` (planning notes, not part of the live dashboard)
- The internal continuity document (names, Brightspace usernames, and org-specific IDs)
- Duck, flag, and monogram logo files
- Simple Syllabus screenshots, widget screenshots, and semester-update screenshots (a sampled course-home image showed a signed-in faculty name)

## Replaced in the copied pages

- `25live`: 3
- `alert-keyword`: 2
- `allowlist-primary`: 2
- `allowlist-secondary`: 2
- `apps-host`: 4
- `bare-domain`: 8
- `brand`: 117
- `brand-upper`: 2
- `campus-contact-name`: 2
- `campus-phone`: 35
- `city-line`: 1
- `dashboard-content-root`: 8
- `doc-creator`: 44
- `doc-creator-email`: 1
- `duck-outline`: 2
- `email-domain`: 56
- `example-email`: 1
- `flag-outline`: 2
- `forms-host`: 18
- `helpdesk-host`: 12
- `intranet-host`: 62
- `intranet-label`: 23
- `leftover-surname`: 1
- `library-host`: 11
- `lms-bare-host`: 4
- `lms-path`: 27
- `maintainer-name`: 3
- `mascot-asset`: 4
- `maxient`: 4
- `monogram`: 2
- `named-contact-email`: 2
- `other-campus-phone`: 2
- `outlook-safelink`: 4
- `peopleadmin`: 1
- `portal-host`: 1
- `portal-label`: 1
- `possessive-brand`: 5
- `readspeaker-id`: 6
- `sandbox-semester`: 1
- `sandbox-template`: 1
- `selfservice-host`: 5
- `semester-screenshots`: 7
- `short-brand`: 2
- `split-campus-phone`: 1
- `street-address`: 1
- `street-address-short`: 4
- `students-host`: 16
- `syllabus-screenshots`: 7
- `term-ou-fall`: 1
- `term-ou-spring`: 1
- `term-ou-winter`: 1
- `traccloud`: 1
- `training-course-ou`: 2
- `widget-screenshots`: 5
- `word-brand`: 34
- `workflow-host`: 1
- `www-host`: 2
- `zoho-form-26fa`: 1
- `zoho-form-26sp`: 1
- `zoho-form-27wi`: 1
- `zoom`: 1

Brightspace usernames on the coming-soon allowlist were replaced with placeholders.
Brightspace paths that started with the college LMS host are now root-relative (`/d2l/...`) or relative to this folder. Other live links (help desk, Maxient, 25Live, PeopleAdmin, Zoom, intranet) point at `example.edu` placeholders.
Term org unit IDs were set to `null`. Sandbox template and semester IDs were set to `0`.
The ReadSpeaker customer ID was set to `00000`.
Tutorial document author metadata was cleared where it named a person and email address.

## Still institution-specific

Role ID maps (for example instructor `102` and the academic role list in private student conversations) were kept so the tools still run. Confirm them against your Brightspace roles before relying on course filters.
The Simple Syllabus walkthrough still names the navbar `ELC Nav - Grand - with Simple Syllabus`. Office room numbers such as J102 were left in place.
Green theme colors were kept. Swap them in `css/` if you do not want that palette.

## Residual scan

No remaining matches for account names, `delta.edu`, live form hosts, the ReadSpeaker customer ID, or the org unit IDs listed above.
