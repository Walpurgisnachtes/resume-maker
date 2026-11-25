# Resume Maker

A local Windows app with three resume formats. Empty sections are omitted.

- **Reference (two-column):** grayscale photo, professional title, bottom-left contact list, and numbered Profile, Education, Skills, and Experience. It keeps the original 210 × 269.32 mm page and the Inter Light / Arial typography.
- **Jake's Resume:** US Letter, with Education, Work Experience, Projects, and Technical Skills. Projects support a technology list, dates, and bullets.
- **sb2nov / Resume:** US Letter, with Education, Work Experience, and Projects. Projects are rendered as a name and description. Skills, introduction, and photo are excluded.

The two classic formats are HTML interpretations of the reference images. Switching templates keeps entered data in the form but hides fields not used by the selected template.

## Run

Requires Node.js 22+ and an installed Google Chrome or Microsoft Edge. No npm packages or API keys are needed. From the workspace root in PowerShell:

```powershell
node '.\resume maker\server.mjs'
```

Open <http://127.0.0.1:4317>. Use `RESUME_PORT` to override the port or `RESUME_BROWSER` to specify the full browser executable path.

1. Enter a company name and fill in your resume details. Add education, experience, and skill rows as needed. Use a manual line break in the professional title if desired, and one line per highlight, skill, or contact link.
2. Select **Preview HTML** to see the whole page, including the contact list at the bottom left, or **Generate PDF** to save it. The company name is only used for the folder, not printed. If the content exceeds one template page, shorten it and generate again.
3. Find the file in the workspace's existing `Resumes\Resume_{company_name}\` directory, for example `Resumes\Resume_Acme_Studio\Alex_Chen_Resume.pdf`. Spaces and Windows-incompatible characters in folder and file names are sanitized; exporting again adds a suffix rather than overwriting an existing PDF.

`template.html` contains the document layout and styles. `resume.mjs` renders its structured sections. Preview and export send form details only to the local server.

**Save draft locally** stores one draft in this browser, including the selected format, form entries for all formats, and photo if it fits the browser's storage limit. Reopening the app at the same address (including port) restores the last manually saved draft. Saving again replaces it. Browser site-data settings can remove it; avoid saving on a shared computer.

## Quick import

Expand **Quick import** and use **Copy** in the **AI Prompt** box. Paste the prompt into Gemini or another AI assistant, add the resume or notes you want to share, then paste the assistant's plain-text reply into Resume Maker and select **Import details**. The app does not contact the assistant.

You can also write the import text by hand, using one `key: value` per line. Start a new entry by repeating its header:

```text
[details]
name: Alex Morgan
role: Software
role: Engineer
location: Hong Kong
contactNote: Open to remote work
email: alex@example.com
phone: +852 1234 5678
link: https://example.com/portfolio
link: https://example.com/projects
introduction: I build and maintain web applications.

[education]
title: BSc Computer Science
school: Example University
location: Hong Kong
dates: 2018 - 2022
highlight: Built an accessible campus map.

[skills]
group: Technical
skill: JavaScript
skill: Python

[experience]
title: Software Engineer
employer: Example Studio
location: Hong Kong
dates: 2022 - Present
highlight: Built an internal reporting tool.

[projects]
title: Neighborhood events tracker
technologies: JavaScript, SQLite
dates: 2024
highlight: Built a searchable directory of community events.
```

Blank lines are ignored; keys and headers are case-insensitive. The opening `[details]` header is optional, and `profile` still works as an alias for `introduction`. Repeat `role`, `link`, `introduction`, `skill`, or `highlight` for multiple lines. Each education, experience, or project entry requires a `title`; each skills group requires at least one `skill`. Legacy `project: Name` lines import as projects with just a title.

**Import details** replaces only the specified personal fields and the entries in sections you include. Omitted fields and sections, company, and photo stay unchanged. Invalid input shows the offending line without changing the form. The import runs in the browser.

**Projects** can be typed or imported for Jake's Resume and sb2nov / Resume. The two-column format does not render them.

## Future: Gemini cover letters

No cover-letter UI, storage, or Gemini requests are enabled in this version. When added, the intended flow is an explicit **Generate cover letter** action that sends the user-provided prompt and approved resume details to Gemini from the server, then saves the result under `CoverLetters\CoverLetter_{company_name}\`. Keep the API key server-side and use the same company-name normalization as for resumes.
