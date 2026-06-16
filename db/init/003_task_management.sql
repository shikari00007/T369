CREATE TABLE IF NOT EXISTS team_members (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'vacation', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_email ON team_members(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status);

CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  task_type TEXT NOT NULL CHECK (task_type IN ('personal', 'professional')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  project_name TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date DATE,
  due_time TIME,
  assigned_to BIGINT REFERENCES team_members(id) ON DELETE SET NULL,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((task_type = 'personal' AND category_id IS NOT NULL) OR task_type = 'professional')
);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_severity ON tasks(severity);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id);

CREATE TABLE IF NOT EXISTS vacations (
  id BIGSERIAL PRIMARY KEY,
  member_id BIGINT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_vacations_member_dates ON vacations(member_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS task_reassignments (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_member BIGINT REFERENCES team_members(id) ON DELETE SET NULL,
  to_member BIGINT REFERENCES team_members(id) ON DELETE SET NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_reassignments_task_id ON task_reassignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_reassignments_created_at ON task_reassignments(created_at DESC);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id BIGSERIAL PRIMARY KEY,
  duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_started_at ON focus_sessions(started_at DESC);