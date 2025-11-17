# Jun Nammoku Portfolio & Blog

Static site powered by [Eleventy](https://www.11ty.dev/) with bilingual content (English/Japanese), a portfolio, and a dark tech blog inspired by Qiita.

## Prerequisites

- Node.js 18+

## Available scripts

- `npm run dev` — start Eleventy in watch + local dev server mode (`http://localhost:8080`).
- `npm run build` — generate the static site into `_site/`.

## Deployment (GitHub Pages)

This repository ships with `.github/workflows/deploy.yml`, which builds Eleventy and deploys `_site/` via GitHub Pages.

1. In the repository settings, open **Pages** and set the source to **GitHub Actions**.
2. Push changes to `main`. The workflow builds the site and publishes it automatically.

## Project structure

```
src/
	assets/           # Shared CSS/JS
	photo/            # Image assets
	index.njk         # Landing page
	en/
		portfolio/      # English portfolio
		blog/
			index.njk     # Blog listing page
			posts/        # Markdown posts (one file per article)
	ja/
		portfolio/      # Japanese portfolio
		blog/
			index.njk     # Japanese blog listing page
			posts/        # Markdown posts (one file per article)
```

## Adding a blog post

1. Duplicate the template below into `src/en/blog/posts/your-slug.md` (and optionally into `src/ja/blog/posts/` for the Japanese version).

	 ```markdown
	 ---
	 title: Observability guardrails for multi-account AWS
	 description: How we standardized logging, metrics, and tracing without slowing teams down.
	 date: 2025-11-10
	 category: Architecture
	 duration: 8 min read
	 tags:
	   - AWS
	   - Observability
	   - Security
	 cta: Read playbook
	 permalink: /en/blog/observability-guardrails/
	 draft: false
	 ---

	 Markdown content goes here. Embed diagrams, code fences, and callouts as needed.
	 ```

2. Run `npm run build` (or `npm run dev` during writing) and commit the Markdown file. Eleventy maintains the blog index automatically.
3. Set `draft: true` while working locally to prevent Eleventy from listing the article. Remove or flip to `false` before publishing.

> Tip: A local-only example lives in `src/en/blog/posts/sample-draft.md` (also mirrored for Japanese). It stays out of git thanks to `.gitignore`—use it as a reference when authoring new posts.

### Notes

- `permalink` controls the final URL. Use the `/en/blog/.../` or `/ja/blog/.../` pattern so language switchers stay in sync.
- Add translated metadata/CTA copy for Japanese posts to keep the experience native.
- `_site/` and `node_modules/` are generated; they are ignored via `.gitignore`.
