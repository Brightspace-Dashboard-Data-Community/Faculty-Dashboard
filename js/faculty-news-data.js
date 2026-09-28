/**
 * Faculty Dashboard — Announcements (static data)
 *
 * Edit FACULTY_NEWS below, then redeploy the dashboard content to Brightspace.
 * Same publish workflow as System Updates (js/updates.js) and Training (js/training.js).
 *
 * Fields:
 *   id, title, content, type ('Announcement'|'Error'|'Update'|'General'),
 *   date (YYYY-MM-DD), created_by, archived, pinned, urgent (true|false|null),
 *   tags (comma-separated string), created_at, updated_at
 *
 * To migrate from Supabase: Table Editor → Export as JSON, map rows into this array.
 */
window.FACULTY_NEWS = [
  // Example (uncomment and edit, or add real items):
  // {
  //   id: 1,
  //   title: 'Welcome to the Faculty Dashboard',
  //   content: 'Announcements for faculty appear here. Edit js/faculty-news-data.js to publish.',
  //   type: 'Announcement',
  //   date: '2026-07-30',
  //   created_by: 'eLearning',
  //   archived: false,
  //   pinned: true,
  //   urgent: false,
  //   tags: 'eLearning Office',
  //   created_at: '2026-07-30T12:00:00.000Z',
  //   updated_at: '2026-07-30T12:00:00.000Z'
  // }
];
