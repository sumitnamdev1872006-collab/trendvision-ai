from __future__ import annotations

import csv
import io
import os
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(BASE_DIR / "trendvision.db")))
SAMPLE_PATH = BASE_DIR / "data" / "sample_posts.csv"
PLATFORMS = {"All", "Instagram", "ShareChat", "YouTube"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS(
    app,
    origins=[
        origin.strip().rstrip("/")
        if origin.strip().startswith(("http://", "https://"))
        else f"https://{origin.strip().rstrip('/')}"
        for origin in cors_origins.split(",")
        if origin.strip()
    ],
)

POSITIVE_WORDS = {
    "good", "great", "love", "favorite", "easy", "better", "best", "calm",
    "cozy", "feel", "win", "enjoy", "satisfying", "save", "help", "warm",
    "gentle", "stick", "counts", "difference", "inviting", "flavor",
}
NEGATIVE_WORDS = {
    "hate", "bad", "hard", "worse", "worst", "tired", "stress", "burnout",
    "difficult", "less", "without", "no", "never", "busy", "perfect",
}


def connect_db() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_db() -> None:
    with connect_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query TEXT NOT NULL,
                platform TEXT NOT NULL,
                date_range TEXT NOT NULL,
                posts_analyzed INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS uploaded_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                platform TEXT NOT NULL,
                author TEXT NOT NULL,
                text TEXT NOT NULL,
                hashtags TEXT NOT NULL,
                likes INTEGER NOT NULL,
                comments INTEGER NOT NULL,
                shares INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL
            )
            """
        )


def uploaded_post_count() -> int:
    with connect_db() as connection:
        return connection.execute("SELECT COUNT(*) FROM uploaded_posts").fetchone()[0]


def sample_data_enabled() -> bool:
    with connect_db() as connection:
        row = connection.execute(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'include_sample_data'"
        ).fetchone()
    return row is None or row["setting_value"] == "true"


def data_source() -> str:
    has_sample = sample_data_enabled()
    has_uploads = uploaded_post_count() > 0
    if has_sample and has_uploads:
        return "SAMPLE + UPLOAD"
    if has_sample:
        return "SAMPLE"
    if has_uploads:
        return "UPLOAD"
    return "EMPTY"


def read_posts() -> list[dict]:
    posts = []
    if sample_data_enabled():
        with SAMPLE_PATH.open(encoding="utf-8", newline="") as source:
            posts = list(csv.DictReader(source))
        latest_sample_date = max(date.fromisoformat(post["created_at"]) for post in posts)
        date_offset = date.today() - latest_sample_date
        for post in posts:
            post["created_at"] = date.fromisoformat(post["created_at"]) + date_offset
            for field in ("likes", "comments", "shares"):
                post[field] = int(post[field])
            post["hashtags"] = [tag for tag in post["hashtags"].split("|") if tag]
            post["interactions"] = post["likes"] + post["comments"] + post["shares"]
            post["sentiment"], post["sentiment_score"] = analyze_text(post["text"])
            post["source"] = "SAMPLE"
    with connect_db() as connection:
        uploaded_rows = connection.execute(
            "SELECT created_at, platform, author, text, hashtags, likes, comments, shares "
            "FROM uploaded_posts ORDER BY id"
        ).fetchall()
    for row in uploaded_rows:
        post = dict(row)
        post["created_at"] = date.fromisoformat(post["created_at"])
        post["hashtags"] = [tag for tag in post["hashtags"].split("|") if tag]
        post["interactions"] = post["likes"] + post["comments"] + post["shares"]
        post["sentiment"], post["sentiment_score"] = analyze_text(post["text"])
        post["source"] = "UPLOAD"
        posts.append(post)
    return posts


def analyze_text(text: str) -> tuple[str, float]:
    words = {word.strip(".,!?':;()").lower() for word in text.split()}
    positive = len(words & POSITIVE_WORDS)
    negative = len(words & NEGATIVE_WORDS)
    score = (positive - negative) / max(positive + negative, 1)
    if score > 0.08:
        return "Positive", round(min(score, 1.0), 2)
    if score < -0.08:
        return "Negative", round(max(score, -1.0), 2)
    return "Neutral", round(score, 2)


def filtered_posts(args) -> list[dict]:
    posts = read_posts()
    query = args.get("query", args.get("q", "")).strip().lower().lstrip("#")
    platform = args.get("platform", "All")
    days_value = args.get("days", "14")
    try:
        days = max(1, min(int(days_value), 365))
    except ValueError:
        days = 14
    cutoff = date.today() - timedelta(days=days - 1)
    if platform not in PLATFORMS:
        platform = "All"
    return [
        post for post in posts
        if (platform == "All" or post["platform"] == platform)
        and post["created_at"] >= cutoff
        and (
            not query
            or query in post["text"].lower()
            or any(query in tag.lower().lstrip("#") for tag in post["hashtags"])
            or query in post["author"].lower()
        )
    ]


def sentiment_summary(posts: list[dict]) -> dict:
    counts = Counter(post["sentiment"] for post in posts)
    total = len(posts) or 1
    positive = counts["Positive"]
    negative = counts["Negative"]
    if positive > negative:
        summary = "Audience reactions lean positive, with recurring appreciation for practical routines, useful ideas, and approachable inspiration."
    elif negative > positive:
        summary = "Reactions show more friction than enthusiasm. Review the posts and topics driving negative language before planning the next campaign."
    else:
        summary = "Audience reactions are mixed or informational. Clearer hooks and a more specific audience promise may help create stronger responses."
    return {
        "counts": {name: counts[name] for name in ("Positive", "Neutral", "Negative")},
        "percentages": {
            name: round(counts[name] / total * 100) for name in ("Positive", "Neutral", "Negative")
        },
        "summary": summary,
        "method": "Lightweight keyword-based demo classifier; not a trained model.",
    }


def safe_csv_text(value: str) -> str:
    text = str(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{text}"
    return text


def topic_counts(posts: list[dict], field: str = "hashtags") -> list[dict]:
    counts = Counter()
    engagement = defaultdict(int)
    display_names = {}
    for post in posts:
        values = post[field] if field == "hashtags" else [word for word in post["text"].lower().split() if len(word) > 5]
        for value in values:
            normalized = value.lower().lstrip("#") if field == "hashtags" else value.strip(".,!?':;()")
            if normalized:
                counts[normalized] += 1
                engagement[normalized] += post["interactions"]
                display_names.setdefault(normalized, value.lstrip("#"))
    result = [
        {"name": display_names[name] if field == "hashtags" else name.title(), "count": count,
         "engagement": engagement[name]}
        for name, count in counts.most_common(12)
    ]
    return result


def trend_result(
    posts: list[dict],
    query: str = "",
    competitor: str = "",
    scope: Mapping[str, str] | None = None,
) -> dict:
    daily = defaultdict(lambda: {"posts": 0, "engagement": 0})
    weekly = defaultdict(lambda: {"posts": 0, "engagement": 0})
    platforms = defaultdict(lambda: {"posts": 0, "engagement": 0})
    for post in posts:
        key = post["created_at"].isoformat()
        week_start = (post["created_at"] - timedelta(days=post["created_at"].weekday())).isoformat()
        daily[key]["posts"] += 1
        daily[key]["engagement"] += post["interactions"]
        weekly[week_start]["posts"] += 1
        weekly[week_start]["engagement"] += post["interactions"]
        platforms[post["platform"]]["posts"] += 1
        platforms[post["platform"]]["engagement"] += post["interactions"]
    series = [
        {"date": key, "posts": value["posts"], "engagement": value["engagement"]}
        for key, value in sorted(daily.items())
    ]
    weekly_series = [
        {"date": key, "posts": value["posts"], "engagement": value["engagement"]}
        for key, value in sorted(weekly.items())
    ]
    leaderboard = topic_counts(posts)
    comparison = []
    if query or competitor:
        comparison_scope = scope or request.args
        for term in (query, competitor):
            if term:
                matched = filtered_posts({
                    "query": term,
                    "platform": comparison_scope.get("platform", "All"),
                    "days": comparison_scope.get("days", "14"),
                })
                comparison.append({
                    "keyword": term.lstrip("#"),
                    "posts": len(matched),
                    "engagement": sum(post["interactions"] for post in matched),
                })
    return {
        "source": data_source(),
        "label": "Sample and uploaded posts; sample posts are illustrative, not live social media data",
        "posts_analyzed": len(posts),
        "daily": series,
        "weekly": weekly_series,
        "top_hashtags": leaderboard[:8],
        "topics": leaderboard[:8],
        "platforms": [
            {"name": name, **values}
            for name, values in sorted(platforms.items())
        ],
        "competitor_comparison": comparison,
        "posts": [
            {
                "date": post["created_at"].isoformat(),
                "platform": post["platform"],
                "author": post["author"],
                "source": post["source"],
                "text": post["text"],
                "hashtags": post["hashtags"],
                "interactions": post["interactions"],
                "sentiment": post["sentiment"],
                "sentiment_score": post["sentiment_score"],
            }
            for post in sorted(posts, key=lambda item: item["created_at"], reverse=True)
        ],
    }


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "source": data_source()})


@app.get("/")
@app.get("/api")
def api_index():
    return jsonify({
        "name": "TrendVision AI",
        "message": "The API is running. Start the React frontend to open the dashboard.",
        "frontend": "http://localhost:5173",
        "health": "/api/health",
        "endpoints": [
            "/api/overview",
            "/api/trends",
            "/api/sentiment",
            "/api/hashtags",
            "/api/recommendations",
            "/api/history",
            "/api/reports.csv",
            "/api/data/upload",
        ],
        "source": data_source(),
    })


@app.get("/api/data/summary")
def data_summary():
    posts = read_posts()
    return jsonify({
        "uploaded_posts": uploaded_post_count(),
        "sample_posts": sum(post["source"] == "SAMPLE" for post in posts),
        "total_posts": len(posts),
        "include_sample": sample_data_enabled(),
        "source": data_source(),
    })


@app.put("/api/data/sample")
def update_sample_data():
    payload = request.get_json(silent=True)
    enabled = payload.get("enabled") if isinstance(payload, dict) else None
    if not isinstance(enabled, bool):
        return jsonify({"error": "The enabled field must be true or false."}), 400
    with connect_db() as connection:
        connection.execute(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES ('include_sample_data', ?) "
            "ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
            ("true" if enabled else "false",),
        )
    posts = read_posts()
    return jsonify({
        "include_sample": enabled,
        "sample_posts": sum(post["source"] == "SAMPLE" for post in posts),
        "total_posts": len(posts),
        "source": data_source(),
    })


@app.post("/api/data/upload")
def upload_data():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "Choose a CSV file to upload."}), 400
    if not upload.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported."}), 400

    try:
        content = upload.stream.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            return jsonify({"error": "CSV file must be 5 MB or smaller."}), 413
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"error": "CSV must use UTF-8 encoding."}), 400

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return jsonify({"error": "CSV must include a header row."}), 400
    columns = {name.strip().lower(): name for name in reader.fieldnames if name}
    date_column = columns.get("created_at") or columns.get("date")
    required = {"platform", "author", "text"}
    missing = required - columns.keys()
    if not date_column or missing:
        expected = "date (or created_at), platform, author, text"
        return jsonify({"error": f"CSV needs these columns: {expected}."}), 400

    imported = []
    for row_number, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue
        try:
            post_date = date.fromisoformat((row.get(date_column) or "").strip()[:10])
            platform = (row.get(columns["platform"]) or "").strip()
            author = (row.get(columns["author"]) or "").strip()
            content_text = (row.get(columns["text"]) or "").strip()
            if platform not in PLATFORMS - {"All"}:
                raise ValueError("platform must be Instagram, ShareChat, or YouTube")
            if not author or not content_text:
                raise ValueError("author and text cannot be empty")

            metrics = []
            for field in ("likes", "comments", "shares"):
                raw_value = (row.get(columns[field]) or "0").strip() if field in columns else "0"
                value = int(raw_value or "0")
                if value < 0:
                    raise ValueError(f"{field} cannot be negative")
                metrics.append(value)
        except (ValueError, TypeError) as validation_error:
            return jsonify({"error": f"Invalid data on CSV row {row_number}: {validation_error}."}), 400

        hashtags = (row.get(columns["hashtags"]) or "").replace(",", "|").strip() if "hashtags" in columns else ""
        imported.append((
            post_date.isoformat(), platform, author, content_text, hashtags,
            metrics[0], metrics[1], metrics[2],
        ))
        if len(imported) > 10_000:
            return jsonify({"error": "A single upload can contain at most 10,000 posts."}), 400

    if not imported:
        return jsonify({"error": "CSV contains no posts to import."}), 400

    with connect_db() as connection:
        connection.executemany(
            "INSERT INTO uploaded_posts "
            "(created_at, platform, author, text, hashtags, likes, comments, shares) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            imported,
        )
        total = connection.execute("SELECT COUNT(*) FROM uploaded_posts").fetchone()[0]
    return jsonify({
        "imported_posts": len(imported),
        "uploaded_posts": total,
        "source": data_source(),
    }), 201


@app.delete("/api/data/uploads")
def clear_uploaded_data():
    with connect_db() as connection:
        cursor = connection.execute("DELETE FROM uploaded_posts")
    return jsonify({"deleted_posts": cursor.rowcount, "source": data_source()})


@app.get("/api/overview")
def overview():
    posts = filtered_posts(request.args)
    sentiments = sentiment_summary(posts)
    platforms = defaultdict(lambda: {"posts": 0, "engagement": 0})
    for post in posts:
        platforms[post["platform"]]["posts"] += 1
        platforms[post["platform"]]["engagement"] += post["interactions"]
    total_interactions = sum(post["interactions"] for post in posts)
    return jsonify({
        "source": data_source(),
        "label": "Sample and uploaded posts; sample posts are illustrative, not live social media data",
        "posts_analyzed": len(posts),
        "average_interactions": round(total_interactions / max(len(posts), 1)),
        "total_interactions": total_interactions,
        "top_topics": topic_counts(posts, "words")[:5],
        "top_hashtags": topic_counts(posts)[:6],
        "sentiment": sentiments,
        "platforms": [
            {"name": name, **values}
            for name, values in sorted(platforms.items())
        ],
    })


@app.get("/api/trends")
def trends():
    posts = filtered_posts(request.args)
    query = request.args.get("query", request.args.get("q", "")).strip()
    competitor = request.args.get("competitor", "").strip()
    return jsonify(trend_result(posts, query, competitor))


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(silent=True) or {}
    args = {
        "query": str(payload.get("query", "")).strip(),
        "platform": str(payload.get("platform", "All")),
        "days": str(payload.get("days", "14")),
    }
    if args["platform"] not in PLATFORMS:
        args["platform"] = "All"
    try:
        args["days"] = str(max(1, min(int(args["days"]), 365)))
    except ValueError:
        args["days"] = "14"
    posts = filtered_posts(args)
    result = trend_result(posts, args["query"], str(payload.get("competitor", "")).strip(), scope=args)
    with connect_db() as connection:
        cursor = connection.execute(
            "INSERT INTO analyses (query, platform, date_range, posts_analyzed, created_at) VALUES (?, ?, ?, ?, ?)",
            (args["query"] or "All topics", args["platform"], f"Last {args['days']} days", len(posts), datetime.now().isoformat(timespec="seconds")),
        )
        result["analysis_id"] = cursor.lastrowid
    return jsonify(result)


@app.get("/api/sentiment")
def sentiment():
    posts = filtered_posts(request.args)
    return jsonify({
        "source": data_source(),
        **sentiment_summary(posts),
        "posts": [
            {"text": post["text"], "sentiment": post["sentiment"], "score": post["sentiment_score"]}
            for post in posts
        ],
    })


@app.get("/api/hashtags")
def hashtags():
    posts = filtered_posts(request.args)
    tags = topic_counts(posts)
    try:
        selected_days = int(request.args.get("days", "14"))
    except ValueError:
        selected_days = 14
    today = date.today()
    recent_cutoff = today - timedelta(days=6)
    previous_cutoff = today - timedelta(days=13)
    recent_counts = Counter(
        tag.lower().lstrip("#")
        for post in posts if post["created_at"] >= recent_cutoff
        for tag in post["hashtags"]
    )
    previous_counts = Counter(
        tag.lower().lstrip("#")
        for post in posts if previous_cutoff <= post["created_at"] < recent_cutoff
        for tag in post["hashtags"]
    )
    for index, tag in enumerate(tags):
        tag["rank"] = index + 1
        name = tag["name"].lower().lstrip("#")
        recent_count = recent_counts[name]
        previous_count = previous_counts[name]
        comparable = selected_days >= 14
        tag["trend"] = (
            "Rising" if comparable and recent_count > previous_count
            else "Cooling" if comparable and recent_count < previous_count
            else "Steady"
        )
        tag["change_percent"] = (
            round((recent_count - previous_count) / previous_count * 100)
            if previous_count else (100 if recent_count and comparable else 0)
        )
        tag["suggestions"] = [
            candidate["name"] for candidate in tags
            if candidate["name"] != tag["name"] and candidate["count"] > 1
        ][:3]
    return jsonify({
        "source": data_source(),
        "label": "Rankings reflect sample and uploaded posts",
        "hashtags": tags,
    })


@app.get("/api/recommendations")
def recommendations():
    posts = filtered_posts(request.args)
    hashtags = topic_counts(posts)
    interests = topic_counts(posts, "words")
    topic = request.args.get("query", "").strip() or (hashtags[0]["name"].lstrip("#") if hashtags else "creator routines")
    return jsonify({
        "source": data_source(),
        "label": "AI-style recommendations · estimates based on available data, not guaranteed results",
        "topic": topic,
        "ideas": [
            {"format": "Reel / Short", "title": f"Three things people get wrong about {topic}", "hook": "Open with the surprising result; keep each tip under 10 seconds."},
            {"format": "Carousel", "title": f"A beginner's guide to {topic}", "hook": "Make each slide one practical action and finish with a save-worthy checklist."},
            {"format": "Video", "title": f"My honest {topic} routine: what actually works", "hook": "Use a personal story, show the process, then invite viewers to share theirs."},
        ],
        "hashtags": [tag["name"] for tag in hashtags[:5]],
        "audience_interests": [item["name"] for item in interests[:5]],
        "strategies": [
            "Lead with a clear, specific benefit in the first two seconds.",
            "Turn recurring audience questions into a short-form series.",
            "Test two opening hooks for the same idea; compare saves and shares in your own analytics.",
        ],
        "disclaimer": "Predictions are estimates for inspiration, not guaranteed outcomes.",
    })


@app.get("/api/history")
def history():
    with connect_db() as connection:
        rows = connection.execute(
            "SELECT id, query, platform, date_range, posts_analyzed, created_at FROM analyses ORDER BY id DESC LIMIT 30"
        ).fetchall()
    return jsonify({"history": [dict(row) for row in rows]})


@app.get("/api/reports.csv")
def report():
    posts = filtered_posts(request.args)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Source", "Date", "Platform", "Author", "Text", "Hashtags", "Interactions", "Sentiment", "Sentiment score"])
    for post in posts:
        writer.writerow([
            safe_csv_text(post["source"]), post["created_at"].isoformat(),
            safe_csv_text(post["platform"]), safe_csv_text(post["author"]),
            safe_csv_text(post["text"]), safe_csv_text(" ".join(post["hashtags"])), post["interactions"],
            post["sentiment"], post["sentiment_score"],
        ])
    return send_file(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"trendvision-report-{date.today().isoformat()}.csv",
    )


initialize_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")
