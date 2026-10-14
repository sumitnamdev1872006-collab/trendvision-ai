# TrendVision AI — Social Media Trend Analysis

TrendVision AI is a responsive, India-focused social listening demo for exploring sample social posts, comparing topics, reviewing lightweight sentiment, getting content prompts, saving analyses, and downloading CSV reports. Sample creator names are Indian, and the supported sample platforms are Instagram, ShareChat, and YouTube.

> **Sample-data notice:** The bundled posts are illustrative demo data, not live or verified social media statistics. This MVP does not include an active social-platform API connector or trained AI model. Sentiment uses a small keyword-based classifier, and recommendations are deterministic prompts based on the sample dataset. Configure and implement an approved official API connector before using real platform data.

## What is included

- React + Vite frontend with Tailwind CSS, responsive navigation, dark mode, Recharts visualizations, filters, loading/error states, and CSV export.
- Daily/weekly trend chart controls, sentiment breakdown, cross-platform activity comparison, and hashtag momentum based on two sample-data weeks.
- Flask JSON API for overview, trends, sentiment, hashtag rankings, recommendations, analysis history, and CSV reports.
- SQLite database for local analysis history. The database file is created automatically on first backend start.
- CSV post uploads for Instagram, ShareChat, and YouTube, with validation and data management in Settings.
- A saved Settings toggle to include or hide bundled sample posts without deleting the sample file or uploaded posts.
- A 36-post sample dataset in `backend/data/sample_posts.csv`.
- Competitor keyword comparison and related hashtag suggestions based on the sample dataset.
- Engagement is shown as interactions per post because the sample dataset has no impressions/reach denominator; the app does not invent an engagement-rate percentage.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer and npm

## Run it on Windows

### Quick start

After installing the requirements below, double-click `run.bat` in the project folder. It opens the API and dashboard in separate terminal windows and opens the dashboard at `http://127.0.0.1:5173`. Keep both terminal windows open while using the app. On the first run, the launcher installs the frontend npm dependencies if they are missing.

### Manual start

Open two PowerShell terminals in the project folder.

### 1. Start the API

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
Copy-Item .env.example .env
py app.py
```

If PowerShell blocks virtual-environment activation, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or run the environment's Python directly with `.\.venv\Scripts\python.exe`.

The API runs at `http://127.0.0.1:5000`. Its root (`http://127.0.0.1:5000/`) shows an API welcome message; the dashboard is served separately by Vite at `http://localhost:5173`. Check API health at `http://127.0.0.1:5000/api/health`.

### 2. Start the frontend

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

The frontend defaults to `http://127.0.0.1:5000/api`. To point it at another API URL, copy `frontend/.env.example` to `frontend/.env.local`, set `VITE_API_URL`, and restart Vite.

## Deploy to Render

The root `render.yaml` defines a free Render web service for the Flask API and a free static site for the React dashboard. It configures the production Gunicorn server, API health check, frontend API URL, and CORS origin automatically.

1. Push the project to a GitHub or GitLab repository. The repository root must contain `render.yaml`.
2. In the [Render Dashboard](https://dashboard.render.com/), select **New > Blueprint** and connect that repository.
3. Review the `trendvision-api` and `trendvision-dashboard` services, then select **Deploy Blueprint**.
4. Once both services finish deploying, open the dashboard's `onrender.com` URL.

The free API service uses temporary local storage for SQLite analysis history and CSV uploads. Saved history and imported posts can reset when Render restarts or redeploys the service; the bundled sample dashboard and API continue to work. Use persistent storage or a managed database if saved history and uploads must survive restarts.

### Production frontend build

```powershell
cd frontend
npm run build
npm run preview
```

## API endpoints

All endpoints are prefixed with `/api`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | API health and current data source |
| GET | `/overview` | Dashboard metrics, topic ranking, platform breakdown, sentiment |
| GET | `/trends` | Daily series, topics, matching posts, optional competitor comparison |
| POST | `/analyze` | Run and persist an analysis in SQLite |
| GET | `/sentiment` | Sample sentiment counts, percentages, and post classifications |
| GET | `/hashtags` | Hashtag frequency, interaction ranking, related tags |
| GET | `/recommendations` | Content prompts and estimated strategies |
| GET | `/history` | Most recent saved analyses |
| GET | `/reports.csv` | Download the filtered matching posts as CSV |
| GET | `/data/summary` | Counts for bundled sample and uploaded posts |
| POST | `/data/upload` | Validate and import a CSV file (up to 5 MB / 10,000 posts) |
| DELETE | `/data/uploads` | Remove imported posts while keeping sample posts |
| PUT | `/data/sample` | Include or hide bundled sample posts in dashboard insights |

Trend, overview, hashtag, sentiment, and report requests accept `platform` (`All`, `Instagram`, `ShareChat`, or `YouTube`), `days` (1–365), and `query` parameters. Trends also accepts `competitor`. Example:

```text
http://127.0.0.1:5000/api/trends?query=wellness&platform=ShareChat&days=14&competitor=mealprep
```

The analyze request body uses the same filters:

```json
{
  "query": "#SlowLiving",
  "platform": "Instagram",
  "days": "14",
  "competitor": "WellnessRoutine"
}
```

## Data and integrations

The application identifies bundled posts as `SAMPLE` and user-imported posts as `UPLOAD`; imports do not turn into live platform data. Use the **Include sample posts** switch in Settings to add or hide the bundled posts from insights; the file remains intact and uploaded posts are unaffected. Upload a CSV from the dashboard or Settings using `date` (or `created_at`), `platform`, `author`, and `text` columns; `hashtags`, `likes`, `comments`, and `shares` are optional. Allowed platforms are Instagram, ShareChat, and YouTube. Download the CSV template in Settings. Uploads are limited to 5 MB and 10,000 posts per file. Sample post dates are shifted to end on the current date so the demo remains useful over time while preserving its original cadence. No supplied API key is assumed to work, and the credential names in `backend/.env.example` are configuration placeholders only. To add live data, implement an adapter for the chosen platform's official API, honor its access scopes, rate limits, and terms, and switch the source label only after an authenticated API response succeeds. Do not relabel sample or uploaded posts as live data.

`DATABASE_PATH` in `backend/.env` can override the default `backend/trendvision.db` location. Analysis history and imported posts are stored in that SQLite database; no account system or cloud sync is included.

## Project layout

```text
backend/
  app.py
  data/sample_posts.csv
  requirements.txt
  .env.example
frontend/
  src/App.jsx
  src/styles.css
  package.json
  .env.example
README.md
```
