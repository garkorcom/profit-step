---
description: Publish a daily development summary to the blog (DevLog)
---

# Publish Daily Summary to Blog

This workflow generates a DevLog article summarizing what was accomplished during the current session and publishes it to Firestore → visible at https://profit-step.web.app/blog

## Steps

1. **Gather session data.** Review all changes made during the session:
   - Files modified/created
   - Features implemented
   - Bugs fixed
   - Key technical decisions

2. **Edit the script.** Open `scripts/publish-daily-summary.js` and update the `DAILY_SUMMARY` object:
   - `date` — today's date (YYYY-MM-DD)
   - `title` — article title with emoji, bilingual (RU+EN)
   - `emoji` — main emoji for the article
   - `featureId` — kebab-case feature identifier
   - `featureTitle` — human-readable feature name
   - `type` — 'feature' | 'bugfix' | 'refactor' | 'infrastructure'
   - `timeSpentMinutes` — estimated time spent
   - `tldr` — one-paragraph tweet-style summary
   - `storyMarkdown` — detailed RU+EN story with markdown formatting
   - `technicalMarkdown` — technical details, changed files, architecture
   - `keyTakeaways` — array of learnings (3-5 items)
   - `seoKeywords` — SEO keyword array
   - `seoDescription` — meta description

3. **Run the publish script.**
// turbo
```bash
GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/garkor_com_gmail.com_application_default_credentials.json node scripts/publish-daily-summary.js
```

4. **Verify.** The article should now be visible at https://profit-step.web.app/blog

## Notes
- The script uses `functions/service-account.json` for Firebase auth
- If no service account file exists, it falls back to application default credentials
- Articles are published immediately (`isPublished: true`)
- The slug is auto-generated from the title + date
