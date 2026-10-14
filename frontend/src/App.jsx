import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bookmark, Check,
  ChevronDown, CircleHelp, Clock3, Download, Hash, Heart, LayoutDashboard,
  Database, FileSpreadsheet, Lightbulb, LoaderCircle, Menu, MessageCircle,
  Moon, Search, Send, Settings2, Sparkles, Sun, TrendingUp, Upload,
  WandSparkles, X, Trash2,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const configuredApiUrl = import.meta.env.VITE_API_URL;
const API_BASE = (
  configuredApiUrl
    ? /^https?:\/\//i.test(configuredApiUrl)
      ? configuredApiUrl
      : `https://${configuredApiUrl}/api`
    : "http://127.0.0.1:5000/api"
).replace(/\/$/, "");
const NAVIGATION = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "trends", label: "Trend analysis", icon: TrendingUp },
  { id: "hashtags", label: "Hashtag explorer", icon: Hash },
  { id: "recommendations", label: "AI recommendations", icon: WandSparkles },
  { id: "history", label: "Analysis history", icon: Clock3 },
];
const SENTIMENT_COLORS = ["#6a59e8", "#f5b544", "#f0757d"];
const shortNumber = (number = 0) => Intl.NumberFormat("en", { notation: number > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(number);
const trendDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // Keep the HTTP status as the visible error when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

function filtersToQuery(filters) {
  const params = new URLSearchParams({ platform: filters.platform, days: filters.days });
  if (filters.query.trim()) params.set("query", filters.query.trim());
  if (filters.competitor.trim()) params.set("competitor", filters.competitor.trim());
  return params.toString();
}

function App() {
  const [page, setPage] = useState("overview");
  const [filters, setFilters] = useState({ query: "", platform: "All", days: "14", competitor: "" });
  const [draftQuery, setDraftQuery] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [trends, setTrends] = useState(null);
  const [hashtags, setHashtags] = useState(null);
  const [recommendations, setRecommendations] = useState(null);
  const [history, setHistory] = useState([]);
  const [dataSummary, setDataSummary] = useState({ sample_posts: 0, uploaded_posts: 0, total_posts: 0, include_sample: true, source: "SAMPLE" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dark, setDark] = useState(() => localStorage.getItem("trendvision-theme") === "dark");
  const [mobileMenu, setMobileMenu] = useState(false);
  const fileInput = useRef(null);

  const currentTitle = NAVIGATION.find((item) => item.id === page)?.label || (page === "settings" ? "Settings" : "Overview");

  const loadDashboard = useCallback(async (activeFilters) => {
    setLoading(true);
    setError("");
    const query = filtersToQuery(activeFilters);
    try {
      const [overview, trendData, hashtagData, recommendationData, historyData, dataInfo] = await Promise.all([
        api(`/overview?${query}`),
        api(`/trends?${query}`),
        api(`/hashtags?${query}`),
        api(`/recommendations?${query}`),
        api("/history"),
        api("/data/summary"),
      ]);
      setDashboard(overview);
      setTrends(trendData);
      setHashtags(hashtagData);
      setRecommendations(recommendationData);
      setHistory(historyData.history);
      setDataSummary(dataInfo);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard(filters);
  }, [filters.platform, filters.days, loadDashboard]);

  useEffect(() => {
    localStorage.setItem("trendvision-theme", dark ? "dark" : "light");
  }, [dark]);

  const applySearch = async (event, searchTerm) => {
    event?.preventDefault();
    const updatedFilters = { ...filters, query: searchTerm ?? draftQuery.trim() };
    setDraftQuery(updatedFilters.query);
    setFilters(updatedFilters);
    setPage("trends");
    setBusy(true);
    setError("");
    try {
      const result = await api("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFilters),
      });
      setTrends(result);
      await loadDashboard(updatedFilters);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const compareKeyword = (competitor) => {
    const updatedFilters = { ...filters, competitor };
    setFilters(updatedFilters);
    loadDashboard(updatedFilters);
  };
  const exportReport = () => {
    const link = document.createElement("a");
    link.href = `${API_BASE}/reports.csv?${filtersToQuery(filters)}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const uploadCsv = async (file) => {
    if (!file) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api("/data/upload", { method: "POST", body: form });
      await loadDashboard(filters);
      setPage("settings");
      setNotice(`Imported ${result.imported_posts} posts. Your dashboard has been refreshed.`);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const clearUploads = async () => {
    if (!dataSummary.uploaded_posts || !window.confirm("Remove all uploaded posts? Sample data will stay available.")) return;
    setError("");
    setNotice("");
    try {
      const result = await api("/data/uploads", { method: "DELETE" });
      await loadDashboard(filters);
      setNotice(`Removed ${result.deleted_posts} uploaded posts. Sample data is still available.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const toggleSampleData = async () => {
    setError("");
    setNotice("");
    try {
      const enabled = !dataSummary.include_sample;
      await api("/data/sample", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await loadDashboard(filters);
      setNotice(enabled ? "Sample posts added to dashboard insights." : "Sample posts removed from dashboard insights. Your uploaded data is unchanged.");
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const downloadCsvTemplate = () => {
    const template = [
      "date,platform,author,text,hashtags,likes,comments,shares",
      `${new Date().toISOString().slice(0, 10)},Instagram,Aanya Sharma,"Sample post text",#IndiaCreators|#TrendVision,0,0,0`,
      "",
    ].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
    link.download = "trendvision-upload-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const goTo = (nextPage) => {
    setPage(nextPage);
    setMobileMenu(false);
  };

  return (
    <div className={`app-shell${dark ? " dark-theme" : ""}`}>
      <aside className={`sidebar${mobileMenu ? " sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <span>trendvision<span className="brand-ai">.ai</span></span>
          <button className="icon-button close-menu" aria-label="Close navigation" onClick={() => setMobileMenu(false)}><X size={18} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">S</div>
          <div className="workspace-copy"><strong>Studio workspace</strong><span>Free plan</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => goTo(id)} className={`nav-item${page === id ? " active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {id === "recommendations" && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip">
            <div className="tip-icon"><Lightbulb size={16} /></div>
            <strong>Make your next post count</strong>
            <span>Turn audience signals into your next big idea.</span>
            <button onClick={() => goTo("recommendations")}>Explore AI ideas <span>→</span></button>
            <div className="tip-orbit orbit-one" /><div className="tip-orbit orbit-two" />
          </div>
          <button className={`nav-item settings-button${page === "settings" ? " active" : ""}`} onClick={() => goTo("settings")}>
            <Settings2 size={17} /><span>Settings</span>
          </button>
          <div className="profile-row">
            <div className="profile-avatar">SY</div>
            <div className="workspace-copy"><strong>Samir Yadav</strong><span>Creator account</span></div>
            <ChevronDown size={15} className="muted-icon" />
          </div>
        </div>
      </aside>
      {mobileMenu && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-trigger" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={19} /></button>
            <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{currentTitle}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="data-status"><span className="status-dot" />{dataSummary.source === "SAMPLE + UPLOAD" ? "Sample + uploads" : dataSummary.source === "UPLOAD" ? "Uploads only" : dataSummary.source === "EMPTY" ? "No data" : "Sample data"}</div>
            <button className="upload-button" aria-label="Upload CSV data" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
              <span>{uploading ? "Uploading…" : "Upload data"}</span>
            </button>
            <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,text/csv" aria-label="Choose a posts CSV file" onChange={(event) => uploadCsv(event.target.files?.[0])} />
            <button className="icon-button help-button" aria-label="About this demo" onClick={() => setError("This demo uses a bundled sample dataset. Connect an official platform API to analyze real data.")}><CircleHelp size={18} /></button>
            <button className="theme-button" aria-label={`Switch to ${dark ? "light" : "dark"} mode`} onClick={() => setDark((value) => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button className="export-button" onClick={exportReport}><Download size={16} /><span>Export report</span></button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />YOUR SOCIAL PULSE</div>
              <h1>{page === "overview" ? "Good morning, Samir" : currentTitle}<span className="heading-sparkle">✳</span></h1>
              <p>{page === "overview" ? "Here's what's happening across your social channels." : pageDescription(page)}</p>
            </div>
            {page !== "settings" && <div className="heading-date"><span className="date-icon">◷</span> Last {filters.days} days <span className="date-dot">·</span> Updated just now</div>}
          </div>

          {page !== "settings" && <section className="filter-bar" aria-label="Analysis filters">
            <form className="search-form" onSubmit={applySearch}>
              <Search size={17} />
              <input aria-label="Search keyword or hashtag" placeholder="Search a keyword or #hashtag..." value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} />
              {draftQuery && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setDraftQuery("")}><X size={15} /></button>}
              <button type="submit" className="search-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <span>Analyze</span>}</button>
            </form>
            <div className="filter-divider" />
            <label className="filter-select"><span>Platform</span><select aria-label="Select platform" value={filters.platform} onChange={(event) => updateFilter("platform", event.target.value)}><option>All</option><option>Instagram</option><option>ShareChat</option><option>YouTube</option></select><ChevronDown size={14} /></label>
            <label className="filter-select date-select"><span>Date range</span><select aria-label="Select date range" value={filters.days} onChange={(event) => updateFilter("days", event.target.value)}><option value="7">Last 7 days</option><option value="14">Last 14 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 365 days</option></select><ChevronDown size={14} /></label>
            <div className="filter-divider optional-divider" />
            <button className="advanced-filter" onClick={() => goTo("trends")}><Settings2 size={16} /><span>Filters</span></button>
          </section>}

          {page !== "settings" && <div className="sample-notice"><span className="notice-spark">✦</span><span><strong>{dataSummary.source === "SAMPLE + UPLOAD" ? "Sample + uploaded data" : dataSummary.source === "UPLOAD" ? "Uploaded data only" : dataSummary.source === "EMPTY" ? "No data selected" : "Exploring with sample data"}</strong><span className="notice-description"> — {dataSummary.source === "SAMPLE + UPLOAD" ? `${dataSummary.uploaded_posts} uploaded posts are included; sample posts remain illustrative.` : dataSummary.source === "UPLOAD" ? `${dataSummary.uploaded_posts} imported posts are included; sample posts are turned off.` : dataSummary.source === "EMPTY" ? "Turn on sample posts or upload a CSV to see insights." : "Insights use an illustrative dataset, not live social media statistics."}</span></span><button onClick={() => goTo("settings")}>Manage data <span>↗</span></button></div>}

          {error && <div className="error-banner" role="alert"><span><strong>Something needs attention.</strong> {error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
          {notice && <div className="success-banner" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={17} /></button></div>}

          {loading ? <LoadingState /> : !dashboard ? (
            <div className="error-state"><Activity size={27} /><strong>Couldn't load your workspace</strong><p>Check that the TrendVision API is running, then try again.</p><button className="primary-button" onClick={() => loadDashboard(filters)}>Try again</button></div>
          ) : (
            <PageContent
              page={page}
              dashboard={dashboard}
              trends={trends}
              hashtags={hashtags}
              recommendations={recommendations}
              history={history}
              dataSummary={dataSummary}
              filters={filters}
              dark={dark}
              competitorChange={compareKeyword}
              onOpen={goTo}
              onRefresh={() => loadDashboard(filters)}
              onSearch={(tag) => applySearch(null, `#${tag}`)}
              onUpload={() => fileInput.current?.click()}
              uploading={uploading}
              onClearUploads={clearUploads}
              onToggleSampleData={toggleSampleData}
              onToggleDark={() => setDark((value) => !value)}
              onDownloadTemplate={downloadCsvTemplate}
            />
          )}
          <footer className="page-footer"><span>© 2026 TrendVision AI</span><span>Insights to impact, thoughtfully.</span><span>Sample-data demo</span></footer>
        </div>
      </main>
    </div>
  );
}

function pageDescription(page) {
  return {
    trends: "See which conversations are growing and where they’re gaining momentum.",
    hashtags: "Find the tags earning attention and discover related ideas to test.",
    recommendations: "Thoughtful, data-inspired ideas to help your next post find its audience.",
    history: "Pick up where you left off and revisit recent analysis.",
    settings: "Manage your imported posts and dashboard preferences.",
  }[page];
}

function LoadingState() {
  return <div className="loading-state"><LoaderCircle size={24} className="spin" /><span>Finding your social pulse…</span><div className="loading-bar"><i /></div></div>;
}

function PageContent({ page, dashboard, trends, hashtags, recommendations, history, dataSummary, filters, dark, competitorChange, onOpen, onRefresh, onSearch, onUpload, uploading, onClearUploads, onToggleSampleData, onToggleDark, onDownloadTemplate }) {
  if (page === "trends") return <TrendsPage trends={trends} filters={filters} competitorChange={competitorChange} />;
  if (page === "hashtags") return <HashtagsPage hashtags={hashtags} onSearch={onSearch} />;
  if (page === "recommendations") return <RecommendationsPage data={recommendations} onRefresh={onRefresh} />;
  if (page === "history") return <HistoryPage history={history} onRefresh={onRefresh} />;
  if (page === "settings") return <SettingsPage dataSummary={dataSummary} dark={dark} uploading={uploading} onUpload={onUpload} onClearUploads={onClearUploads} onToggleSampleData={onToggleSampleData} onToggleDark={onToggleDark} onDownloadTemplate={onDownloadTemplate} />;
  return <OverviewPage dashboard={dashboard} trends={trends} hashtags={hashtags} filters={filters} onOpen={onOpen} />;
}

function OverviewPage({ dashboard, trends, hashtags, filters, onOpen }) {
  const [trendPeriod, setTrendPeriod] = useState("daily");
  const isSampleOnly = dashboard.source === "SAMPLE";
  const sentimentData = useMemo(() => [
    { name: "Positive", value: dashboard.sentiment.percentages.Positive },
    { name: "Neutral", value: dashboard.sentiment.percentages.Neutral },
    { name: "Negative", value: dashboard.sentiment.percentages.Negative },
  ], [dashboard]);
  const total = sentimentData.reduce((sum, item) => sum + item.value, 0) || 1;
  const activityData = trendPeriod === "weekly" ? trends?.weekly : trends?.daily;
  return (
    <>
      <section className="metric-grid">
        <MetricCard label="Posts analyzed" value={shortNumber(dashboard.posts_analyzed)} icon={MessageCircle} tone="purple" detail="Across your selected channels" />
        <MetricCard label="Total interactions" value={shortNumber(dashboard.total_interactions)} icon={Heart} tone="pink" detail="Likes, comments & shares" />
        <MetricCard label="Avg. interactions / post" value={shortNumber(dashboard.average_interactions)} icon={Activity} tone="blue" detail="Sample engagement proxy" />
        <MetricCard label="Top conversation" value={dashboard.top_hashtags[0]?.name || "—"} icon={TrendingUp} tone="green" detail={`${dashboard.top_hashtags[0]?.count || 0} mentions`} isText />
      </section>

      <section className="dashboard-grid chart-row">
        <article className="panel trend-panel">
          <PanelHeader title="Conversation activity" subtitle="Post volume & interactions over time" action={<button className="text-link" onClick={() => onOpen("trends")}>View trends <span>→</span></button>} />
          <div className="chart-legend"><span><i className="legend-purple" /> Posts</span><span><i className="legend-yellow" /> Interactions</span><div className="period-controls"><button className={trendPeriod === "daily" ? "selected" : ""} onClick={() => setTrendPeriod("daily")}>Daily</button><button className={trendPeriod === "weekly" ? "selected" : ""} onClick={() => setTrendPeriod("weekly")}>Weekly</button></div><span className="chart-range">Last {filters.days} days</span></div>
          <div className="activity-chart">
            {activityData?.length ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs><linearGradient id="postsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7565ed" stopOpacity={0.2} /><stop offset="95%" stopColor="#7565ed" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line-soft)" />
                <XAxis dataKey="date" tickFormatter={trendDate} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} minTickGap={22} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" hide />
                <Tooltip labelFormatter={trendDate} contentStyle={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
                <Area yAxisId="left" type="monotone" dataKey="posts" name="Posts" stroke="#7768ec" strokeWidth={2.5} fill="url(#postsFill)" activeDot={{ r: 5 }} />
                <Area yAxisId="right" type="monotone" dataKey="engagement" name="Interactions" stroke="#f5b544" strokeWidth={2} fill="none" strokeDasharray="5 5" activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer> : <EmptyChart message="No matching posts in this date range." />}
          </div>
          <div className="chart-footnote"><span className="footnote-icon">✳</span> Posts and interactions across the selected range <span className="footnote-arrow">{isSampleOnly ? "SAMPLE" : "SAMPLE + UPLOAD"}</span></div>
        </article>

        <article className="panel sentiment-panel">
          <PanelHeader title="Audience sentiment" subtitle="How people are reacting" action={<button className="more-button" aria-label="About sentiment"><CircleHelp size={16} /></button>} />
          <div className="sentiment-visual">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={sentimentData} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="94%" startAngle={90} endAngle={-270} paddingAngle={4} stroke="none" cornerRadius={5}>{sentimentData.map((item, index) => <Cell key={item.name} fill={SENTIMENT_COLORS[index]} />)}</Pie></PieChart>
              </ResponsiveContainer>
              <div className="donut-center"><strong>{dashboard.sentiment.percentages.Positive}%</strong><span>positive</span></div>
            </div>
            <div className="sentiment-key">{sentimentData.map((item, index) => <div key={item.name} className="sentiment-key-row"><span className="sentiment-dot" style={{ backgroundColor: SENTIMENT_COLORS[index] }} /><span>{item.name}</span><strong>{Math.round(item.value / total * 100)}%</strong></div>)}</div>
          </div>
          <div className="sentiment-insight"><div className="insight-icon"><Sparkles size={15} /></div><p>{dashboard.sentiment.summary}</p></div>
          <span className="classifier-note">Lightweight keyword-based demo classifier</span>
        </article>
      </section>

      <section className="dashboard-grid lower-row">
        <article className="panel topics-panel">
          <PanelHeader title="Trending conversations" subtitle="Topics making a little noise" action={<button className="text-link" onClick={() => onOpen("trends")}>See all <span>→</span></button>} />
          <div className="topic-table">
            <div className="table-head"><span>TOPIC</span><span>MENTIONS</span><span>INTERACTIONS</span><span>TREND</span></div>
            {(dashboard.top_hashtags || []).slice(0, 5).map((topic, index) => <div className="topic-row" key={topic.name}>
              <span className="topic-name"><span className={`topic-rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span><span>#{topic.name}</span></span>
              <span className="topic-mentions">{topic.count}</span><span className="topic-engagement">{shortNumber(topic.engagement)}</span>
              <TrendPill trend={hashtags?.hashtags?.find((item) => item.name === topic.name)?.trend || "Steady"} />
            </div>)}
          </div>
          <button className="panel-bottom-link" onClick={() => onOpen("hashtags")}>Explore all hashtags <span>→</span></button>
        </article>
        <article className="panel platform-panel">
          <PanelHeader title="Channel snapshot" subtitle="Where the conversation lives" action={<button className="more-button" aria-label="Channel details"><CircleHelp size={16} /></button>} />
          <div className="platform-chart">
            {dashboard.platforms?.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={dashboard.platforms} layout="vertical" margin={{ left: 4, right: 10, top: 0, bottom: 0 }} barSize={12}>
              <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="var(--line-soft)" />
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={71} tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip cursor={{ fill: "var(--line-soft)" }} contentStyle={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
              <Bar dataKey="posts" name="Posts" fill="#7869ed" radius={[0, 5, 5, 0]} />
            </BarChart></ResponsiveContainer> : <EmptyChart message="No channel data yet." />}
          </div>
          <div className="platform-summary">{(dashboard.platforms || []).map((item) => <div key={item.name}><span className={`platform-mark ${item.name.toLowerCase()}`}>{item.name === "ShareChat" ? "S" : item.name === "Instagram" ? "◎" : "▶"}</span><span>{item.name}</span><strong>{shortNumber(item.engagement)}</strong><small>interactions</small></div>)}</div>
        </article>
      </section>
      <section className="bottom-insight">
        <div className="bottom-insight-mark"><Sparkles size={18} /></div><div><strong>Your next big idea might be hiding in the comments.</strong><span>Explore audience-inspired content ideas based on today's trends.</span></div>
        <button onClick={() => onOpen("recommendations")}>Get AI ideas <span>→</span></button>
      </section>
    </>
  );
}

function MetricCard({ label, value, icon: Icon, tone, detail, isText }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17} strokeWidth={1.9} /></span></div><strong className={`metric-value${isText ? " metric-text" : ""}`}>{value}</strong><div className="metric-detail"><span className="detail-dot" />{detail}</div></article>;
}

function PanelHeader({ title, subtitle, action }) {
  return <div className="panel-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>;
}

function TrendsPage({ trends, filters, competitorChange }) {
  const [competitorDraft, setCompetitorDraft] = useState(filters.competitor);
  const [trendPeriod, setTrendPeriod] = useState("daily");
  useEffect(() => setCompetitorDraft(filters.competitor), [filters.competitor]);
  const series = trendPeriod === "weekly" ? trends?.weekly || [] : trends?.daily || [];
  const isSampleOnly = trends?.source === "SAMPLE";
  return <>
    <section className="metric-grid compact-metrics">
      <MetricCard label="Matching posts" value={shortNumber(trends?.posts_analyzed || 0)} icon={MessageCircle} tone="purple" detail="For selected filters" />
      <MetricCard label="Trending topics" value={trends?.topics?.length || 0} icon={TrendingUp} tone="green" detail={isSampleOnly ? "Across sample conversations" : "Across available posts"} />
      <MetricCard label="Interactions" value={shortNumber(series.reduce((total, row) => total + row.engagement, 0))} icon={Heart} tone="pink" detail="Likes, comments & shares" />
      <MetricCard label="Top hashtag" value={trends?.top_hashtags?.[0]?.name || "—"} icon={Hash} tone="blue" detail={isSampleOnly ? "By sample frequency" : "By post frequency"} isText />
    </section>
    <section className="panel standalone-panel">
      <PanelHeader title={filters.query ? `Trend analysis: ${filters.query}` : "Trend momentum"} subtitle={`${trendPeriod === "daily" ? "Daily" : "Weekly"} post volume and engagement`} action={<span className="sample-mini-tag">{isSampleOnly ? "SAMPLE" : "SAMPLE + UPLOAD"}</span>} />
      <div className="trend-page-controls"><div className="period-controls"><button className={trendPeriod === "daily" ? "selected" : ""} onClick={() => setTrendPeriod("daily")}>Daily</button><button className={trendPeriod === "weekly" ? "selected" : ""} onClick={() => setTrendPeriod("weekly")}>Weekly</button></div></div>
      <div className="large-chart">{series.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={series} margin={{ top: 15, right: 20, left: -10, bottom: 0 }}>
        <defs><linearGradient id="largeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7565ed" stopOpacity={0.2} /><stop offset="100%" stopColor="#7565ed" stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line-soft)" /><XAxis dataKey="date" tickFormatter={trendDate} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} minTickGap={20} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
        <Tooltip labelFormatter={trendDate} contentStyle={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
        <Area type="monotone" dataKey="posts" name="Posts" stroke="#7768ec" strokeWidth={2.5} fill="url(#largeFill)" /><Area type="monotone" dataKey="engagement" name="Interactions" stroke="#f5b544" strokeWidth={2} fill="none" strokeDasharray="5 5" />
      </AreaChart></ResponsiveContainer> : <EmptyChart message="No posts match those filters. Try a different keyword or date range." />}</div>
    </section>
    <div className="analysis-two-column">
      <section className="panel standalone-panel"><PanelHeader title="Topic leaderboard" subtitle={isSampleOnly ? "Ranked by sample mentions" : "Ranked by post mentions"} /><div className="leaderboard-list">{(trends?.topics || []).slice(0, 8).map((topic, index) => <div className="leaderboard-row" key={topic.name}><span className="leaderboard-rank">{String(index + 1).padStart(2, "0")}</span><strong>#{topic.name}</strong><span className="leaderboard-count">{topic.count} posts</span><span className="leaderboard-bar"><i style={{ width: `${Math.max(10, (topic.count / (trends.topics[0]?.count || 1)) * 100)}%` }} /></span></div>)}</div></section>
      <section className="panel standalone-panel compare-panel"><PanelHeader title="Compare keywords" subtitle="Compare post volume side by side" />
        <form className="competitor-field" onSubmit={(event) => { event.preventDefault(); competitorChange(competitorDraft); }}><span>Second keyword or hashtag</span><div><input aria-label="Competitor keyword" placeholder="e.g. #SlowLiving" value={competitorDraft} onChange={(event) => setCompetitorDraft(event.target.value)} /><button className="primary-button" type="submit">Compare</button></div></form>
        <div className="compare-results">{(trends?.competitor_comparison || []).length ? trends.competitor_comparison.map((item, index) => <div key={`${item.keyword}-${index}`}><span className={`compare-marker marker-${index}`} /><strong>#{item.keyword}</strong><b>{item.posts}</b><small>posts</small></div>) : <p>Search a keyword above, then add a second one here to compare conversation volume.</p>}</div>
        <span className="classifier-note">A directional comparison based on available text matches.</span>
      </section>
    </div>
    <p className="method-note"><Sparkles size={14} /> Emerging topics are ranked from available posts; they do not represent live platform trends.</p>
  </>;
}

function HashtagsPage({ hashtags, onSearch }) {
  const items = hashtags?.hashtags || [];
  const isSampleOnly = hashtags?.source === "SAMPLE";
  return <>
    <div className="hashtag-banner"><div className="hashtag-banner-icon"><Hash size={21} /></div><div><strong>Your hashtag cheat sheet</strong><span>Frequency and interactions from {isSampleOnly ? "illustrative sample posts" : "sample and uploaded posts"}.</span></div><span className="sample-mini-tag">{isSampleOnly ? "SAMPLE DATA" : "SAMPLE + UPLOAD"}</span></div>
    <section className="panel standalone-panel"><PanelHeader title="Popular hashtags" subtitle="Find a tag worth testing with your next post." action={<span className="table-count">{items.length} tags</span>} />
      <div className="hashtag-table">
        <div className="hashtag-table-head"><span>RANK & HASHTAG</span><span>SAMPLE POSTS</span><span>INTERACTIONS</span><span>STATUS</span><span>RELATED TAGS</span><span></span></div>
        {items.map((tag, index) => <div className="hashtag-table-row" key={tag.name}>
          <span className="hashtag-name"><b>{String(index + 1).padStart(2, "0")}</b><strong>#{tag.name}</strong></span><span>{tag.count}</span><span>{shortNumber(tag.engagement)}</span>
          <span><TrendPill trend={tag.trend} change={tag.change_percent} /></span>
          <span className="related-tags">{tag.suggestions?.slice(0, 2).map((suggestion) => <button key={suggestion} onClick={() => onSearch(suggestion)}>#{suggestion}</button>)}</span>
          <button className="tag-search-button" aria-label={`Search ${tag.name}`} onClick={() => onSearch(tag.name)}><Search size={15} /></button>
        </div>)}
      </div>
      {!items.length && <EmptyChart message="No hashtag matches. Try widening your filters." />}
      <div className="table-disclaimer">Direction compares two 7-day periods in the available dataset; it is not a live growth signal.</div>
    </section>
    <div className="hashtag-tip"><Sparkles size={17} /><span><strong>Mix broad and specific.</strong> Pair a high-frequency tag with a niche community hashtag to reach people who care about your topic.</span></div>
  </>;
}

function RecommendationsPage({ data, onRefresh }) {
  const sourceLabel = data?.source === "SAMPLE" ? "sample conversations" : "available conversations";
  return <>
    <div className="recommendation-hero"><div className="recommendation-orb orb-a" /><div className="recommendation-orb orb-b" /><div className="recommendation-hero-content"><span className="ai-pill"><Sparkles size={13} /> YOUR CREATIVE SIDEKICK</span><h2>Good ideas meet good timing.</h2><p>Here's a little inspiration shaped by {sourceLabel} around <strong>{data?.topic || "your topic"}</strong>.</p><button onClick={onRefresh}><WandSparkles size={15} /> Refresh suggestions</button></div><div className="hero-note"><span>✦</span> Ideas, not guarantees.<br /><small>Always make them your own.</small></div></div>
    <section className="panel ideas-panel"><PanelHeader title="Ideas to make your own" subtitle="Three formats inspired by audience conversation patterns." />
      <div className="idea-grid">{(data?.ideas || []).map((idea, index) => <article className="idea-card" key={idea.format}><div className={`idea-card-icon idea-${index}`}>{index === 0 ? <Activity size={18} /> : index === 1 ? <Bookmark size={18} /> : <Send size={18} />}</div><div className="idea-format">{idea.format}<span> IDEA 0{index + 1}</span></div><h3>{idea.title}</h3><p>{idea.hook}</p><button onClick={() => navigator.clipboard?.writeText(`${idea.title}\n${idea.hook}`)}><Check size={14} /> Copy idea</button></article>)}</div>
    </section>
    <div className="analysis-two-column recommendation-bottom">
      <section className="panel standalone-panel"><PanelHeader title="Hashtags to explore" subtitle="Frequently used alongside your selected topic." /><div className="chip-list">{(data?.hashtags || []).map((tag) => <span key={tag}>#{tag}</span>)}</div></section>
      <section className="panel standalone-panel"><PanelHeader title="Audience interests" subtitle="Common themes in the available posts." /><div className="interest-list">{(data?.audience_interests || []).map((interest, index) => <div key={interest}><span>{index + 1}</span>{interest}<i style={{ width: `${80 - index * 11}%` }} /></div>)}</div></section>
    </div>
    <section className="panel strategy-panel"><PanelHeader title="A few thoughtful strategies" subtitle="Low-risk experiments to test with your audience." /><div className="strategy-list">{(data?.strategies || []).map((strategy, index) => <div key={strategy}><span>{String(index + 1).padStart(2, "0")}</span><p>{strategy}</p><Check size={15} /></div>)}</div></section>
    <p className="method-note"><Sparkles size={14} /> {data?.disclaimer || "Predictions are estimates, not guaranteed results."}</p>
  </>;
}

function HistoryPage({ history, onRefresh }) {
  return <section className="panel standalone-panel history-panel"><PanelHeader title="Recent analysis" subtitle="Your searches are saved locally in the workspace database." action={<button className="text-link" onClick={onRefresh}>Refresh <span>↻</span></button>} />
    {history.length ? <div className="history-list">{history.map((item) => <div className="history-row" key={item.id}><span className="history-icon"><Search size={17} /></span><div className="history-main"><strong>{item.query}</strong><span>{item.platform} <i>·</i> {item.date_range}</span></div><span className="history-count">{item.posts_analyzed} posts</span><time>{new Date(item.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></div>)}</div> : <div className="history-empty"><Clock3 size={22} /><strong>No analyses yet</strong><span>Search a keyword or hashtag to save your first analysis here.</span></div>}
    <div className="table-disclaimer">Analysis history is stored in the local SQLite database and is not linked to a user account.</div>
  </section>;
}

function SettingsPage({ dataSummary, dark, uploading, onUpload, onClearUploads, onToggleSampleData, onToggleDark, onDownloadTemplate }) {
  return <div className="settings-grid">
    <section className="panel settings-card">
      <PanelHeader title="Your data" subtitle="Import your own posts or manage existing uploads." />
      <div className="data-summary"><span className="settings-icon"><Database size={18} /></span><div><strong>{dataSummary.total_posts} posts available</strong><span>{dataSummary.sample_posts} sample · {dataSummary.uploaded_posts} uploaded</span></div></div>
      <div className="setting-row"><div><strong>Include sample posts</strong><span>Show or hide demo posts in dashboard insights.</span></div><button className={`toggle-switch${dataSummary.include_sample ? " enabled" : ""}`} role="switch" aria-checked={dataSummary.include_sample} aria-label="Toggle sample data" onClick={onToggleSampleData}><span /></button></div>
      <div className="settings-actions">
        <button className="primary-button" onClick={onUpload} disabled={uploading}>{uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{uploading ? "Uploading…" : "Upload CSV"}</button>
        <button className="secondary-button" onClick={onDownloadTemplate}><FileSpreadsheet size={15} />Download CSV template</button>
      </div>
      <div className="upload-guidance"><strong>CSV columns</strong><code>date, platform, author, text, hashtags, likes, comments, shares</code><span>Required: date, platform, author, text. Platforms: Instagram, ShareChat, YouTube. Hashtags can be separated by |. Maximum 10,000 rows and 5 MB per upload.</span></div>
      <button className="danger-button" onClick={onClearUploads} disabled={!dataSummary.uploaded_posts}><Trash2 size={15} />Remove uploaded posts</button>
    </section>
    <section className="panel settings-card">
      <PanelHeader title="Appearance" subtitle="Make the dashboard comfortable to use." />
      <div className="setting-row"><div><strong>Dark mode</strong><span>Use a darker dashboard theme.</span></div><button className={`toggle-switch${dark ? " enabled" : ""}`} role="switch" aria-checked={dark} aria-label="Toggle dark mode" onClick={onToggleDark}><span /></button></div>
      <div className="setting-row"><div><strong>API connection</strong><span>Current dashboard data endpoint</span></div></div>
      <code className="api-address">{API_BASE}</code>
      <div className="settings-footnote">Uploaded data is stored in the local workspace database. On free hosting, local storage may reset when the service restarts.</div>
    </section>
  </div>;
}

function EmptyChart({ message }) {
  return <div className="empty-chart"><BarChart3 size={24} /><span>{message}</span></div>;
}

function TrendPill({ trend, change }) {
  const rising = trend === "Rising";
  const cooling = trend === "Cooling";
  return <span className={`trend-badge ${rising ? "trend-up" : "trend-flat"}`}>
    {rising ? <ArrowUpRight size={13} /> : cooling ? <ArrowDownRight size={13} /> : null}
    {trend}{Number.isFinite(change) && change !== 0 ? ` ${change > 0 ? "+" : ""}${change}%` : ""}
  </span>;
}

export default App;
