# Analytics & Event Tracking Setup

**Document:** Holdfast Protocol Launch Metrics Infrastructure
**Owner:** Web Engineer + CMO
**Use Case:** Real-time dashboards and automated data export for launch monitoring
**Timeline:** Complete before T+0 launch

---

## Overview

This document defines:
1. Analytics platforms and configuration
2. Event taxonomy (what we measure)
3. Dashboard templates (real-time + reporting)
4. Data export automation (hourly snapshots)
5. Tools and access setup

---

## Part 1: Analytics Platforms

### Platform 1: Google Analytics 4

**Purpose:** Website traffic, onboarding flow completion, content engagement

**Setup:**
- Property ID: [TBD]
- Site: holdfastprotocol.com
- Deployment: Add GA4 tag to all pages (Tag Manager or direct)

**Key Pages to Track:**
- `/` (homepage)
- `/docs` (documentation hub)
- `/quickstart` (getting started)
- `/blog/devnet-launch` (launch blog post)
- `/blog/*` (all blog posts)

**Events to Configure:**
```
Event: page_view
  - page_path
  - page_title

Event: scroll_progress
  - page_path
  - scroll_percentage (25%, 50%, 75%, 100%)

Event: button_click
  - button_name (e.g., "Install SDK", "Join Discord")
  - page_path

Event: form_submission
  - form_name (e.g., "newsletter_signup")
  - success (true/false)

Event: external_link_click
  - link_target (e.g., "github.com", "discord.gg")
  - page_path
```

**Metrics to Extract (T+1h, T+24h):**
- `/blog/devnet-launch` page views (24h)
- `/quickstart` page views (24h)
- `/quickstart` scroll completion (% of users reaching end)
- Onboarding flow completion rate (from start to "Install SDK" click)
- External link clicks (GitHub, Discord)
- Bounce rate (homepage)

---

### Platform 2: Twitter/X Analytics

**Purpose:** Thread performance, engagement, reach, sentiment

**Setup:**
- Account: @holdfastprotocol
- Access: Enable analytics for the account

**Built-in Metrics (Manual Collection):**
At T+1h, T+6h, T+12h, T+24h, record:
- Tweet 1 (announcement) — Impressions, Replies, Retweets, Likes
- Tweet 2-8 — Impressions, Engagement rate
- Thread aggregate — Total impressions, total engagement, new followers

**Sentiment Tracking (Manual):**
- Review replies to Tweet 1
- Categorize: Positive (enthusiasm) / Neutral (informational) / Negative (criticism)
- Count: Min 50 replies minimum for reasonable sample

**Tracking Tool:** Twitter's native analytics dashboard (free with business account)

**Data Export:** Screenshot metrics at T+1h and T+24h, store in shared folder

---

### Platform 3: GitHub Insights

**Purpose:** Repository stars, issues, discussions, community activity

**Setup:**
- Repository: github.com/holdfastprotocol/protocol
- Enable: Insights (default)

**Built-in Metrics:**
- Stargazers (total count, delta since T+0)
- Issues (new count, open/closed count)
- Discussions (new threads, activity)
- Community activity feed

**Metrics to Extract (T+1h, T+24h):**
- Total stars at T+0, T+1h, T+24h (calculate delta)
- New issues filed (count)
- New discussions (count)
- Top categories: Setup help / Bugs / Features (manual categorization)

**Data Source:** GitHub Issues API
```
GET /repos/holdfastprotocol/protocol/issues?state=all&since=T+0_timestamp

Parse each issue:
  - created_at (to determine if new since launch)
  - title (to categorize)
  - labels (if available)
```

**Tracking Tool:** GitHub API + custom script (see "Data Export Automation" section)

---

### Platform 4: npm Registry

**Purpose:** Package downloads, install success rate

**Setup:**
- Packages:
  - @holdfastprotocol/sdk
  - @holdfastprotocol/eliza-plugin

**Built-in Metrics:**
- npm registry shows weekly/monthly downloads (not real-time)
- npm stats API provides daily download counts

**Metrics to Extract (T+24h, then daily):**
```
GET https://api.npmjs.org/downloads/point/2026-04-28/@holdfastprotocol/sdk

Response:
{
  "downloads": 47,
  "start": "2026-04-28T00:00:00.000Z",
  "end": "2026-04-28T23:59:59.999Z"
}
```

**Tracking Tool:** npm registry API + custom script (see "Data Export Automation")

---

### Platform 5: Discord Insights

**Purpose:** Server growth, message activity, sentiment

**Setup:**
- Server: Casemate Labs workspace
- Channel: #holdfast-dev (primary)
- Other channels: #general, #announcements

**Built-in Metrics:**
- Server member count (visible in settings)
- Messages per day (visible in analytics, if enabled)
- User activity feed

**Manual Metrics to Track (T+1h, T+24h):**
- New member joins (count)
- Total members (delta from baseline)
- Number of questions/help requests (count)
- Number of answers/helpful posts (count)
- Critical issues reported (boolean: yes/no)

**Tracking Tool:** Manual observation + Discord.py bot for automation (optional)

---

## Part 2: Event Taxonomy

### Events to Instrument (On-Site & Via SDK)

**Goal:** Track developer adoption and friction points

#### 1. SDK Installation & Setup

```json
{
  "event_name": "sdk_install_started",
  "timestamp": "2026-04-28T12:00:00Z",
  "user_id": "[anonymous or tracking ID]",
  "framework": "nodejs" | "python" | "rust",
  "installation_method": "npm" | "pip" | "cargo"
}
```

```json
{
  "event_name": "sdk_install_completed",
  "timestamp": "2026-04-28T12:05:00Z",
  "user_id": "[same as install_started]",
  "sdk_version": "1.0.0",
  "success": true | false,
  "error_message": "[if failed]"
}
```

#### 2. First Code Example Execution

```json
{
  "event_name": "quickstart_example_started",
  "timestamp": "2026-04-28T12:10:00Z",
  "user_id": "[tracking ID]",
  "example_type": "pact_creation" | "escrow" | "reputation_lookup",
  "environment": "devnet" | "testnet" | "mainnet"
}
```

```json
{
  "event_name": "quickstart_example_completed",
  "timestamp": "2026-04-28T12:15:00Z",
  "user_id": "[same as started]",
  "example_type": "pact_creation",
  "success": true | false,
  "duration_seconds": 300,
  "error_category": "[if failed]"
}
```

#### 3. ElizaOS Plugin Integration

```json
{
  "event_name": "eliza_plugin_install_started",
  "timestamp": "2026-04-28T12:00:00Z",
  "user_id": "[tracking ID]",
  "eliza_version": "0.1.4"
}
```

```json
{
  "event_name": "eliza_plugin_pact_created",
  "timestamp": "2026-04-28T12:30:00Z",
  "user_id": "[tracking ID]",
  "pact_type": "agent_contract" | "escrow_agreement",
  "counterparty_type": "agent" | "human",
  "success": true | false
}
```

#### 4. Documentation & Learning

```json
{
  "event_name": "docs_page_viewed",
  "timestamp": "2026-04-28T12:00:00Z",
  "page_path": "/docs/api-reference",
  "time_on_page_seconds": 240,
  "scroll_depth_percent": 75
}
```

```json
{
  "event_name": "docs_code_example_copied",
  "timestamp": "2026-04-28T12:05:00Z",
  "code_snippet_id": "pact_creation_example_1",
  "language": "typescript"
}
```

#### 5. Community Engagement

```json
{
  "event_name": "github_issue_created",
  "timestamp": "2026-04-28T12:45:00Z",
  "user_id": "[GitHub username]",
  "issue_category": "bug" | "feature" | "question" | "security",
  "title": "[issue title]"
}
```

```json
{
  "event_name": "discord_message_posted",
  "timestamp": "2026-04-28T12:50:00Z",
  "user_id": "[Discord user ID]",
  "channel": "#holdfast-dev",
  "message_type": "question" | "answer" | "feedback" | "other"
}
```

### Event Collection Methods

1. **Website events:** Google Analytics 4 + custom event tracking (JavaScript)
2. **SDK events:** Telemetry in SDK (optional, with user consent)
3. **GitHub events:** GitHub API webhook or polling
4. **Discord events:** Discord.py bot with event handlers
5. **npm events:** npm registry API polling

---

## Part 3: Dashboards

### Dashboard 1: Launch Day Real-Time (T+0 to T+24h)

**Purpose:** CEOs/CMO monitoring in real-time

**Platform:** Google Sheets (manual updates) or Grafana (automated)

**Refresh Rate:** Every 15 minutes during T+0-T+6h, then hourly

**Metrics:**

| Metric | Source | Baseline (T+0 -1h) | T+1h Target | T+24h Target |
|--------|--------|---|---|---|
| Twitter impressions | X Analytics | — | 500+ | 10,000+ |
| Twitter engagement rate | X Analytics | — | 2%+ | 3%+ |
| GitHub stars | GitHub API | [baseline] | +5 | +50 |
| New GitHub issues | GitHub API | 0 | 3+ | 20+ |
| npm downloads (@holdfastprotocol/sdk) | npm API | 0 | 10+ | 100+ |
| npm downloads (@holdfastprotocol/eliza-plugin) | npm API | 0 | 5+ | 50+ |
| New Discord members | Manual count | [baseline] | +10 | +100 |
| Website sessions | GA4 | — | 50+ | 500+ |
| /quickstart page views | GA4 | — | 20+ | 200+ |
| Critical issues reported | Manual | 0 | 0 | 0 |

**Success Criteria Highlighted:**
- ✅ All numbers meeting or exceeding targets

### Dashboard 2: Post-Launch Daily (T+2d onwards)

**Purpose:** Strategic assessment of launch momentum

**Refresh Rate:** Once daily (8am UTC)

**Metrics:**

| Metric | Daily Value | Trend (vs. prev day) | Notes |
|--------|---|---|---|
| npm downloads (SDK) | ___ | ↑ ↓ → | Sustained interest? |
| GitHub stars | ___ | ↑ ↓ → | Community reception |
| GitHub issues | ___ | ↑ ↓ → | Developer friction? |
| Discord members | ___ | ↑ ↓ → | Growth rate slowing? |
| Support tickets open | ___ | ↑ ↓ → | Team load management |
| Blog traffic | ___ | ↑ ↓ → | Content resonance |

**Decision Trigger:**
- If trend is down for 2 consecutive days → escalate to strategy discussion
- If trend is flat after T+3d → activate Phase 2 content push

### Dashboard 3: T+7d Assessment (Strategic)

**Purpose:** Decide next phase (Phase 1 → Phase 2 vs Phase 1 → pivot)

**Metrics Buckets:**

**Adoption:**
- Total npm downloads (24h): ___
- Cumulative downloads (T+0 to T+7d): ___
- New GitHub stars (T+7d): ___
- New GitHub issues filed: ___
- New Discord members: ___

**Engagement:**
- SDK developers who got past "npm install": ___ (est.)
- Developers who ran first code example: ___ (est.)
- ElizaOS plugin downloads: ___
- GitHub discussion threads created: ___

**Community Sentiment:**
- Twitter positive sentiment: ___%
- GitHub positive issues (non-bugs): ___%
- Discord questions answered within 4h: ___%
- Zero critical bugs on Day 7: ☐ Yes ☐ No

**Ecosystem Response:**
- Partner inquiries received: ___
- Integration proposals: ___
- Case study candidates: ___

**Assessment Output:** Strong / Moderate / Slow (informs Phase 3 strategy)

---

## Part 4: Data Export Automation

### Automated Hourly Export

**Purpose:** Archive metrics in structured format (Google Sheets or JSON) for post-launch analysis

**Schedule:** T+0 through T+7d, hourly at :15 (9:15, 10:15, etc. UTC)

**Data Points to Export:**

```json
{
  "timestamp": "2026-04-28T13:15:00Z",
  "metrics": {
    "twitter": {
      "tweet_1_impressions": 1250,
      "tweet_1_engagement_rate": 2.4,
      "thread_total_impressions": 8500,
      "new_followers": 42
    },
    "github": {
      "stars_total": 285,
      "stars_delta_since_launch": 42,
      "new_issues_24h": 12,
      "open_issues": 8,
      "discussions_new": 3
    },
    "npm": {
      "sdk_downloads_24h": 78,
      "eliza_plugin_downloads_24h": 34
    },
    "discord": {
      "members_total": 145,
      "members_delta": 23,
      "messages_24h": 87
    },
    "website": {
      "sessions_24h": 312,
      "quickstart_views": 89
    }
  }
}
```

**Export Destinations:**
1. Google Sheets (shared folder): `launch-metrics-[date].csv`
2. JSON file (GitHub releases folder): `metrics-T+[hours].json`
3. Paperclip attachment to status update

**Tool to Use:** Node.js script (runs on scheduler or GitHub Actions)

### Sample Script (Node.js)

```javascript
// export-metrics.js
const fs = require('fs');
const https = require('https');

async function fetchMetrics() {
  const metrics = {};

  // GitHub API
  const ghData = await fetch('https://api.github.com/repos/holdfastprotocol/protocol', {
    headers: { 'Authorization': `token ${process.env.GH_TOKEN}` }
  }).then(r => r.json());
  metrics.github = {
    stars_total: ghData.stargazers_count,
    open_issues: ghData.open_issues_count
  };

  // npm API
  const npmData = await fetch('https://api.npmjs.org/downloads/point/2026-04-28/@holdfastprotocol/sdk')
    .then(r => r.json());
  metrics.npm = { sdk_downloads_24h: npmData.downloads };

  // Write to CSV
  const csv = `timestamp,metric,value\n${Object.entries(metrics)
    .flatMap(([category, data]) =>
      Object.entries(data).map(([key, val]) =>
        `${new Date().toISOString()},${category}_${key},${val}`
      )
    ).join('\n')}`;

  fs.writeFileSync('metrics-export.csv', csv);
  console.log('Metrics exported');
}

fetchMetrics().catch(console.error);
```

---

## Part 5: Setup Checklist

### Pre-Launch (T-30min)

**Google Analytics 4:**
- [ ] GA4 property created
- [ ] Tracking tag deployed to all pages (Tag Manager)
- [ ] Test: Load homepage, verify event in real-time
- [ ] Custom events configured (scroll, button clicks)
- [ ] Goals set up (quickstart completion)

**GitHub API:**
- [ ] Personal access token created (with repo read access)
- [ ] Test: `curl https://api.github.com/repos/holdfastprotocol/protocol -H "Authorization: token [TOKEN]"`
- [ ] Response includes stargazers_count

**npm API:**
- [ ] Test both packages:
  - `curl https://api.npmjs.org/downloads/point/2026-04-28/@holdfastprotocol/sdk`
  - `curl https://api.npmjs.org/downloads/point/2026-04-28/@holdfastprotocol/eliza-plugin`

**Twitter/X:**
- [ ] @holdfastprotocol account has analytics enabled
- [ ] Test: Post test tweet, verify shows in analytics
- [ ] Set up manual metrics collection template (screenshot app or notes)

**Discord:**
- [ ] Bot invited to server (if using automation)
- [ ] Bot has permissions: read messages, send messages
- [ ] Test: Bot can count members `len(guild.members)`

**Google Sheets (Data Export):**
- [ ] Shared folder created with team access
- [ ] Template columns set up (timestamp, metric, value)
- [ ] Backup method set up (GitHub releases as backup)

### T+0 to T+24h (Active Monitoring)

- [ ] Metrics dashboard open on screens (CMO + CEO)
- [ ] Hourly export script running (or manual updates every 15 min)
- [ ] Slack/Discord alerts set up for critical thresholds:
  - GitHub: +10 issues in 1 hour → alert
  - npm: <5 downloads per hour → alert (slow)
  - Discord: >50 questions waiting → alert
- [ ] Someone checking Twitter sentiment manually every 30 min

### T+2d onwards (Automated)

- [ ] Export script running on schedule (hourly)
- [ ] Daily summary emailed to team (8am UTC)
- [ ] Weekly trend analysis (every Monday)

---

## Part 6: Tools & Access Matrix

| Tool | Purpose | Owner | Access Level | Credentials |
|------|---------|-------|---|---|
| Google Analytics 4 | Website traffic | Web Engineer | Admin | [Email] |
| Google Sheets | Manual metrics log | CMO | Editor | [Google account] |
| GitHub API | Star count, issues | Web Engineer | Read-only token | [GH token] |
| npm Registry API | Download counts | Web Engineer | Public API | [None needed] |
| Twitter Analytics | Engagement metrics | CMO | Account admin | [@holdfastprotocol account] |
| Discord | Member count, activity | CMO | Moderator | [Discord account] |
| Paperclip | Status updates + metrics | CMO | Comment access | [HOL-217] |

---

## Part 7: Analysis Framework

### T+1h Quick Check
- Is there anything obviously broken? (0 downloads, 0 website traffic)
- Is there baseline engagement? (any questions, any retweets?)
- Any critical bugs reported?

### T+24h Full Assessment
- How close are we to targets? (see Dashboard 1)
- What exceeded expectations?
- What underperformed?
- Top 3 user pain points (from issues + Discord)?

### T+7d Strategic Decision
- Growth trajectory: Strong / Moderate / Slow?
- Which channel performed best? (Twitter, GitHub, Discord?)
- Biggest friction point for developers?
- Sentiment trend: Improving / Stable / Declining?

**Output:** Detailed metrics report posted to HOL-217 + recommendations for Phase 2/3

---

**Status: Ready for deployment before T+0**
