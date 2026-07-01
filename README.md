# T369 -  Task369

Task369 is a fully self-hosted, offline-capable, local-first web application based on the 3-6-9 framework.

- 3 Foundation activities
- 6 Growth activities
- 9 Mastery activities

It includes a premium single-page dashboard, category activity management, planner, journal, progress tracking, XP + achievements, and local themes.

## Key Guarantees

- No authentication
- No external APIs
- No cloud backends
- No telemetry or analytics
- All app data stored in local PostgreSQL
- Runs locally with Docker Compose only

## Tech Stack

- Backend: Node.js + Express + TypeScript
- Frontend: Static single-page app (HTML/CSS/JS)
- Database: PostgreSQL 16
- Charts: Chart.js served locally from app container
- Containers: app + postgres only

## Included Features

- Responsive dashboard with 20 life categories
- Category detail drawer with 3/6/9 sections
- Activity completion, notes, priority, due date, status
- Daily 369 planner (Morning 3, Afternoon 6, Night 9)
- Dedicated `369 Planner` page with planner flash cards and date-wise title
- Planner delete action for date-based cleanup
- Journal system:
  - Daily / weekly / monthly entries
  - Search by content/tags
  - Rich text editor
- Progress tracking:
  - Total completion
  - Category completion
  - Daily/weekly/monthly streaks
  - Visual charts
- Gamification:
  - XP model (3-tier=10, 6-tier=25, 9-tier=50)
  - Levels: Novice, Explorer, Warrior, Master, Legend
  - Achievements (first completion, streaks, category/life milestones)
- Themes:
  - Dark (default)
  - Light
  - Anime
  - Cyberpunk
- Task management extension:
  - Dashboard task tabs for Personal Tasks and Professional Tasks
  - Personal task CRUD with severity/status filters and weekly grouping
  - Professional task CRUD with assignment, weekly timeline, and coverage widgets
  - Team members module (create, edit, archive)
  - Vacation calendar module with list and edit workflows
  - Vacation conflict detection for assigned professional tasks
  - Task reassignment workflow and reassignment audit history
  - Focus timer with presets/custom duration, alerts, and session statistics

## Project Structure

- `src/` backend API and domain logic
- `public/` static one-page dashboard UI
- `db/init/` automatic DB bootstrap scripts
- `db/migrations/` migration snapshots
- `scripts/` backup and restore scripts
- `docker-compose.yml` runtime orchestration
- `Dockerfile` multi-stage app build

## Run (Only Docker Compose)

From the project root:

```bash
docker compose up -d --build
```

Open:

- App: http://localhost:8080
- Health: http://localhost:8080/health

## First Login

There is no login. The app starts directly into the dashboard.

A local default profile (`Local Hero`) is initialized in PostgreSQL automatically.

## Environment

A ready `.env` is included. You may optionally copy from `.env.example` and customize:

```bash
cp .env.example .env
```

Most users can run without changing env values for local usage.

## Database Schema

Tables created automatically:

- users
- categories
- activities
- planner_entries
- journal_entries
- achievements
- xp_history
- settings
- tasks
- team_members
- vacations
- task_reassignments
- focus_sessions

## Task Management APIs

Tasks:

- `GET /api/tasks`
- `POST /api/tasks`
- `PUT /api/tasks/:id`
- `DELETE /api/tasks/:id`

Team Members:

- `GET /api/team-members`
- `POST /api/team-members`
- `PUT /api/team-members/:id`
- `DELETE /api/team-members/:id`

Vacations:

- `GET /api/vacations`
- `POST /api/vacations`
- `PUT /api/vacations/:id`
- `DELETE /api/vacations/:id`

Reassignments:

- `GET /api/reassignments`
- `POST /api/reassignments`

Focus Sessions:

- `GET /api/focus-sessions`
- `POST /api/focus-sessions`

Planner:

- `GET /api/life-category/planner?date=YYYY-MM-DD`
- `PUT /api/life-category/planner`
- `DELETE /api/life-category/planner?date=YYYY-MM-DD`

## Backup and Recovery

Detailed guide: [Backup&Recovery.md](Backup%26Recovery.md)

### Backup (Linux/macOS/WSL)

```bash
./scripts/backup.sh
```

What backup now includes:

- PostgreSQL SQL dump
- SHA256 integrity checksum
- metadata file
- compressed archive (`.zip` when available, otherwise `.tar.gz`)
- retention cleanup (default 90 days)

### Restore (Linux/macOS/WSL)

```bash
./scripts/restore.sh backups/t369_YYYYMMDD_HHMMSS.zip
```

Restore behavior:

- verifies checksum before import
- asks for confirmation by default
- drops/recreates `public` schema before restore (safe default)

Non-interactive restore:

```bash
./scripts/restore.sh --yes backups/t369_YYYYMMDD_HHMMSS.zip
```

Restore without schema cleanup (advanced):

```bash
./scripts/restore.sh --yes --no-clean backups/t369_YYYYMMDD_HHMMSS.zip
```

### Weekly Backup Schedule (Linux)

Edit cron:

```bash
crontab -e
```

Example weekly schedule (Sunday 02:30):

```cron
30 2 * * 0 cd /absolute/path/to/3-6-9-App && ./scripts/backup.sh >> backups/backup-cron.log 2>&1
```

Verify schedule:

```bash
crontab -l
```

## Health Checks

Docker health checks included for:

- `postgres` via `pg_isready`
- `app` via `/health`

## Production Hardening Implemented

- Multi-stage Docker build
- Non-root app container user
- Strict backend validation with Zod
- Server-side error handling
- Persistent PostgreSQL volume
- No dependency on internet services at runtime

## Troubleshooting

1. If app is not loading:
   - Run `docker compose ps`
   - Check logs: `docker compose logs app`
2. If database is unhealthy:
   - Check logs: `docker compose logs postgres`
3. If port 8080 is occupied:
   - Change host mapping in `docker-compose.yml`
4. Reset local data:
   - `docker compose down -v`
   - `docker compose up -d --build`

## Offline Mode Notes

After containers and images are built once, the app runs fully offline on the local machine.

No external runtime requests are required by the app.
