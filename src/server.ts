import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import dayjs from 'dayjs';
import { z } from 'zod';
import { query, withTransaction } from './db';
import { CATEGORY_SEEDS } from './seedData';

const app = express();
const port = Number(process.env.APP_PORT || 8080);
const host = process.env.APP_HOST || '0.0.0.0';
const defaultUserId = 1;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));

type ActivityRow = {
  id: number;
  category_id: number;
  tier: number;
  title: string;
  notes: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  due_date: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'blocked';
  completed: boolean;
};

type TaskType = 'personal' | 'professional';
type TaskSeverity = 'high' | 'medium' | 'low';
type TaskStatus = 'pending' | 'in_progress' | 'completed';
type TeamMemberStatus = 'active' | 'vacation' | 'archived';

type TaskRow = {
  id: number;
  task_type: TaskType;
  title: string;
  description: string;
  project_name: string | null;
  severity: TaskSeverity;
  status: TaskStatus;
  due_date: string | null;
  end_date: string | null;
  due_time: string | null;
  assigned_to: number | null;
  category_id: number | null;
  notes: string;
  mandays: number | null;
  created_at: string;
  updated_at: string;
  category_name: string | null;
  assigned_name: string | null;
  team_member_status: TeamMemberStatus | null;
  has_conflict: boolean;
  reassignment_count: number;
};

const updateActivitySchema = z.object({
  completed: z.boolean().optional(),
  notes: z.string().max(3000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  due_date: z.string().date().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked']).optional()
});

const plannerSchema = z.object({
  date: z.string().date(),
  morning: z.array(z.string()).max(20),
  afternoon: z.array(z.string()).max(30),
  night: z.array(z.string()).max(40)
});

const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'anime', 'cyberpunk'])
});

const taskSchema = z
  .object({
    task_type: z.enum(['personal', 'professional']),
    title: z.string().min(1).max(180),
    description: z.string().max(5000).default(''),
    project_name: z.string().max(180).nullable().optional(),
    severity: z.enum(['high', 'medium', 'low']),
    assigned_to: z.coerce.number().int().positive().nullable().optional(),
    category_id: z.coerce.number().int().positive().nullable().optional(),
    due_date: z.string().date().nullable().optional(),
    end_date: z.string().date().nullable().optional(),
    due_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Invalid time')
      .nullable()
      .optional(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    mandays: z.coerce.number().min(0).nullable().optional(),
    notes: z.string().max(5000).default('')
  })
  .superRefine((value, ctx) => {
    if (value.task_type === 'personal' && !value.category_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category_id'], message: 'Personal tasks require a category' });
    }
    if (value.task_type === 'professional' && !value.project_name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['project_name'], message: 'Professional tasks require a project name' });
    }
  });

const teamMemberSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(180),
  role: z.string().min(1).max(120),
  status: z.enum(['active', 'vacation']).default('active')
});

const vacationSchema = z
  .object({
    member_id: z.coerce.number().int().positive(),
    start_date: z.string().date(),
    end_date: z.string().date(),
    reason: z.string().max(400).default('')
  })
  .refine((value) => dayjs(value.end_date).isSame(dayjs(value.start_date)) || dayjs(value.end_date).isAfter(dayjs(value.start_date)), {
    message: 'End date must be on or after start date',
    path: ['end_date']
  });

const reassignmentSchema = z.object({
  task_id: z.coerce.number().int().positive(),
  from_member: z.coerce.number().int().positive().nullable().optional(),
  to_member: z.coerce.number().int().positive(),
  reason: z.string().max(400).default('')
});

const focusSessionSchema = z
  .object({
    duration_minutes: z.coerce.number().int().positive().max(720),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime()
  })
  .refine((value) => dayjs(value.completed_at).isAfter(dayjs(value.started_at)), {
    message: 'Completion time must be after start time',
    path: ['completed_at']
  });

function xpForTier(tier: number): number {
  if (tier === 3) return 10;
  if (tier === 6) return 25;
  return 50;
}

function levelFromXp(xp: number): string {
  if (xp >= 2000) return 'Legend';
  if (xp >= 1000) return 'Master';
  if (xp >= 500) return 'Warrior';
  if (xp >= 200) return 'Explorer';
  return 'Novice';
}

function normalizeTaskPayload(payload: z.infer<typeof taskSchema>) {
  return {
    task_type: payload.task_type,
    title: payload.title.trim(),
    description: payload.description?.trim() || '',
    project_name: payload.project_name?.trim() || null,
    severity: payload.severity,
    assigned_to: payload.assigned_to ?? null,
    category_id: payload.category_id ?? null,
    due_date: payload.due_date ?? null,
    end_date: (payload as any).end_date ?? null,
    due_time: payload.due_time ? payload.due_time.slice(0, 5) : null,
    status: payload.status,
    mandays: (payload as any).mandays ?? null,
    notes: payload.notes?.trim() || ''
  };
}

function toTaskResponse(row: TaskRow) {
  return {
    ...row,
    conflict: row.has_conflict,
    conflict_message: row.has_conflict ? 'Assigned employee is on vacation.' : null,
    overdue: Boolean(row.due_date && dayjs(row.due_date).isBefore(dayjs().startOf('day')) && row.status !== 'completed')
  };
}

async function computeStreaks(): Promise<{ daily: number; weekly: number; monthly: number }> {
  const rows = await query<{ d: string }>(
    `SELECT DISTINCT DATE(completed_at) AS d
     FROM activities
     WHERE completed = TRUE AND completed_at IS NOT NULL
     ORDER BY d DESC`
  );

  const daySet = new Set(rows.rows.map((r) => dayjs(r.d).format('YYYY-MM-DD')));
  let daily = 0;
  let cursor = dayjs().startOf('day');

  while (daySet.has(cursor.format('YYYY-MM-DD'))) {
    daily += 1;
    cursor = cursor.subtract(1, 'day');
  }

  return {
    daily,
    weekly: Math.floor(daily / 7),
    monthly: Math.floor(daily / 30)
  };
}

async function awardAchievement(code: string, title: string, description: string): Promise<boolean> {
  const res = await query(
    `INSERT INTO achievements (user_id, code, title, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, code) DO NOTHING`,
    [defaultUserId, code, title, description]
  );
  return (res.rowCount ?? 0) > 0;
}

async function refreshAchievements(): Promise<string[]> {
  const unlocked: string[] = [];

  const totalsRes = await query<{ completed: string; xp: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE completed = TRUE)::int AS completed,
       COALESCE((SELECT SUM(xp) FROM xp_history WHERE user_id = $1), 0)::int AS xp
     FROM activities`,
    [defaultUserId]
  );

  const completedTasks = Number(totalsRes.rows[0]?.completed || 0);
  const totalXp = Number(totalsRes.rows[0]?.xp || 0);
  const streaks = await computeStreaks();

  const allCategoryDoneRes = await query<{ done_categories: string }>(
    `SELECT COUNT(*)::int AS done_categories
     FROM (
       SELECT c.id
       FROM categories c
       JOIN activities a ON a.category_id = c.id
       GROUP BY c.id
       HAVING BOOL_AND(a.completed = TRUE)
     ) t`
  );
  const doneCategories = Number(allCategoryDoneRes.rows[0]?.done_categories || 0);

  if (completedTasks >= 1 && (await awardAchievement('first_completion', 'First Completion', 'Completed your first 369 activity'))) unlocked.push('First Completion');
  if (streaks.daily >= 1 && (await awardAchievement('first_streak', 'First Streak', 'Started your first completion streak'))) unlocked.push('First Streak');
  if (streaks.daily >= 7 && (await awardAchievement('streak_7', '7 Day Streak', 'Maintained a 7-day completion streak'))) unlocked.push('7 Day Streak');
  if (streaks.daily >= 30 && (await awardAchievement('streak_30', '30 Day Streak', 'Maintained a 30-day completion streak'))) unlocked.push('30 Day Streak');
  if (completedTasks >= 100 && (await awardAchievement('tasks_100', '100 Tasks Completed', 'Completed 100 activities'))) unlocked.push('100 Tasks Completed');
  if (doneCategories >= 1 && (await awardAchievement('category_master', 'Category Master', 'Fully completed one life category'))) unlocked.push('Category Master');
  if (doneCategories >= CATEGORY_SEEDS.length && (await awardAchievement('life_master', 'Life Master', 'Fully completed every category'))) unlocked.push('Life Master');
  if (totalXp >= 2000 && (await awardAchievement('legend_xp', 'Legend XP', 'Reached Legend level by XP'))) unlocked.push('Legend XP');

  return unlocked;
}

async function ensureSeedData(): Promise<void> {
  for (const category of CATEGORY_SEEDS) {
    const catRes = await query<{ id: number }>(
      `INSERT INTO categories (name, icon, avatar, color_a, color_b)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name)
       DO UPDATE SET icon = EXCLUDED.icon, avatar = EXCLUDED.avatar, color_a = EXCLUDED.color_a, color_b = EXCLUDED.color_b
       RETURNING id`,
      [category.name, category.icon, category.avatar, category.colorA, category.colorB]
    );

    const categoryId = catRes.rows[0].id;
    const countRes = await query<{ total: string }>(`SELECT COUNT(*)::int AS total FROM activities WHERE category_id = $1`, [categoryId]);
    const count = Number(countRes.rows[0]?.total || 0);
    if (count >= 18) continue;

    await query('DELETE FROM activities WHERE category_id = $1', [categoryId]);

    const pushActivities = async (tier: 3 | 6 | 9, list: string[]) => {
      for (let i = 0; i < list.length; i += 1) {
        await query(
          `INSERT INTO activities (category_id, tier, title, position)
           VALUES ($1, $2, $3, $4)`,
          [categoryId, tier, list[i], i + 1]
        );
      }
    };

    await pushActivities(3, category.foundation);
    await pushActivities(6, category.growth);
    await pushActivities(9, category.mastery);
  }
}

async function ensureTaskManagementSchema(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS team_members (
       id BIGSERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       email TEXT NOT NULL,
       role TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'vacation', 'archived')),
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_email ON team_members(LOWER(email))`,
    `CREATE INDEX IF NOT EXISTS idx_team_members_status ON team_members(status)`,
    `CREATE TABLE IF NOT EXISTS tasks (
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
     )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(task_type)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_severity ON tasks(severity)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_category_id ON tasks(category_id)`,
    `CREATE TABLE IF NOT EXISTS vacations (
       id BIGSERIAL PRIMARY KEY,
       member_id BIGINT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
       start_date DATE NOT NULL,
       end_date DATE NOT NULL,
       reason TEXT NOT NULL DEFAULT '',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       CHECK (end_date >= start_date)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_vacations_member_dates ON vacations(member_id, start_date, end_date)`,
    `CREATE TABLE IF NOT EXISTS task_reassignments (
       id BIGSERIAL PRIMARY KEY,
       task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
       from_member BIGINT REFERENCES team_members(id) ON DELETE SET NULL,
       to_member BIGINT REFERENCES team_members(id) ON DELETE SET NULL,
       reason TEXT NOT NULL DEFAULT '',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_task_reassignments_task_id ON task_reassignments(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_task_reassignments_created_at ON task_reassignments(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS focus_sessions (
       id BIGSERIAL PRIMARY KEY,
       duration_minutes INT NOT NULL CHECK (duration_minutes > 0),
       started_at TIMESTAMPTZ NOT NULL,
       completed_at TIMESTAMPTZ NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_focus_sessions_started_at ON focus_sessions(started_at DESC)`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_date DATE`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mandays NUMERIC(8,2)`,
    `CREATE TABLE IF NOT EXISTS team_mandays (
       id BIGSERIAL PRIMARY KEY,
       member_id BIGINT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
       task_id BIGINT REFERENCES tasks(id) ON DELETE CASCADE,
       project_name TEXT NOT NULL DEFAULT '',
       mandays NUMERIC(8,2) NOT NULL DEFAULT 0,
       start_date DATE,
       end_date DATE,
       month_key TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_team_mandays_member ON team_mandays(member_id)`,
    `CREATE INDEX IF NOT EXISTS idx_team_mandays_month ON team_mandays(member_id, month_key)`
  ];

  for (const statement of statements) {
    await query(statement);
  }
}

async function syncTeamMemberStatuses(): Promise<void> {
  await query(
    `UPDATE team_members tm
     SET status = CASE
       WHEN tm.status = 'archived' THEN 'archived'
       WHEN EXISTS (
         SELECT 1
         FROM vacations v
         WHERE v.member_id = tm.id
           AND CURRENT_DATE BETWEEN v.start_date AND v.end_date
       ) THEN 'vacation'
       ELSE 'active'
     END`
  );
}

async function ensureCategoryExists(categoryId: number | null): Promise<void> {
  if (!categoryId) return;
  const result = await query<{ id: number }>('SELECT id FROM categories WHERE id = $1', [categoryId]);
  if (!result.rows[0]) {
    throw new Error('CATEGORY_NOT_FOUND');
  }
}

async function ensureTeamMemberExists(memberId: number | null): Promise<void> {
  if (!memberId) return;
  const result = await query<{ id: number; status: TeamMemberStatus }>('SELECT id, status FROM team_members WHERE id = $1', [memberId]);
  if (!result.rows[0] || result.rows[0].status === 'archived') {
    throw new Error('TEAM_MEMBER_NOT_FOUND');
  }
}

async function getDashboardPayload() {
  const categoriesRes = await query<{
    id: number;
    name: string;
    icon: string;
    avatar: string;
    color_a: string;
    color_b: string;
    total: string;
    done: string;
  }>(
    `SELECT c.id, c.name, c.icon, c.avatar, c.color_a, c.color_b,
            COUNT(a.id)::int AS total,
            COUNT(*) FILTER (WHERE a.completed = TRUE)::int AS done
     FROM categories c
     LEFT JOIN activities a ON a.category_id = c.id
     GROUP BY c.id
     ORDER BY c.name ASC`
  );

  const totalsRes = await query<{ completed: string; total: string; xp: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE completed = TRUE)::int AS completed,
       COUNT(*)::int AS total,
       COALESCE((SELECT SUM(xp) FROM xp_history WHERE user_id = $1), 0)::int AS xp
     FROM activities`,
    [defaultUserId]
  );

  const streaks = await computeStreaks();
  const completed = Number(totalsRes.rows[0]?.completed || 0);
  const total = Number(totalsRes.rows[0]?.total || 0);
  const totalXp = Number(totalsRes.rows[0]?.xp || 0);
  const level = levelFromXp(totalXp);

  return {
    categories: categoriesRes.rows.map((c) => {
      const done = Number(c.done || 0);
      const all = Number(c.total || 0);
      const progress = all > 0 ? Math.round((done / all) * 100) : 0;
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        avatar: c.avatar,
        colorA: c.color_a,
        colorB: c.color_b,
        done,
        total: all,
        progress,
        status: progress === 100 ? 'Completed' : progress >= 60 ? 'Strong' : progress >= 30 ? 'Growing' : 'Starting'
      };
    }),
    totals: {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      xp: totalXp,
      level,
      streaks
    }
  };
}

async function getTasks(taskType?: TaskType, severity?: TaskSeverity, status?: TaskStatus, searchText?: string) {
  await syncTeamMemberStatuses();

  const clauses: string[] = [];
  const values: unknown[] = [];

  if (taskType) {
    values.push(taskType);
    clauses.push(`t.task_type = $${values.length}`);
  }

  if (severity) {
    values.push(severity);
    clauses.push(`t.severity = $${values.length}`);
  }

  if (status) {
    values.push(status);
    clauses.push(`t.status = $${values.length}`);
  }

  if (searchText) {
    values.push(`%${searchText}%`);
    clauses.push(`(
      t.title ILIKE $${values.length}
      OR t.description ILIKE $${values.length}
      OR t.notes ILIKE $${values.length}
      OR COALESCE(t.project_name, '') ILIKE $${values.length}
      OR t.status ILIKE $${values.length}
      OR COALESCE(tm.name, '') ILIKE $${values.length}
      OR COALESCE(tm.email, '') ILIKE $${values.length}
    )`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const taskRes = await query<TaskRow>(
    `SELECT t.id,
            t.task_type,
            t.title,
            t.description,
            t.project_name,
            t.severity,
            t.status,
            t.due_date::text,
            t.end_date::text,
            TO_CHAR(t.due_time, 'HH24:MI') AS due_time,
            t.assigned_to,
            t.category_id,
            t.notes,
            t.mandays,
            t.created_at::text,
            t.updated_at::text,
            c.name AS category_name,
            tm.name AS assigned_name,
            tm.status AS team_member_status,
            EXISTS (
              SELECT 1
              FROM vacations v
              WHERE v.member_id = t.assigned_to
                AND t.due_date IS NOT NULL
                AND t.due_date BETWEEN v.start_date AND v.end_date
            ) AS has_conflict,
            COALESCE((SELECT COUNT(*)::int FROM task_reassignments tr WHERE tr.task_id = t.id), 0) AS reassignment_count
     FROM tasks t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN team_members tm ON tm.id = t.assigned_to
     ${whereClause}
     ORDER BY COALESCE(t.due_date, CURRENT_DATE + INTERVAL '100 years') ASC,
              t.due_time ASC NULLS LAST,
              t.created_at DESC`,
    values
  );

  const tasks = taskRes.rows.map(toTaskResponse);

  const summary = {
    total: tasks.length,
    high: tasks.filter((task) => task.severity === 'high').length,
    medium: tasks.filter((task) => task.severity === 'medium').length,
    low: tasks.filter((task) => task.severity === 'low').length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    in_progress: tasks.filter((task) => task.status === 'in_progress').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    overdue: tasks.filter((task) => task.overdue).length,
    conflicts: tasks.filter((task) => task.conflict).length,
    reassigned: tasks.filter((task) => task.reassignment_count > 0).length
  };

  let widgets: Record<string, number> = {};
  if (taskType === 'professional') {
    const teamCountsRes = await query<{ status: TeamMemberStatus; total: string }>(
      `SELECT status, COUNT(*)::int AS total
       FROM team_members
       GROUP BY status`
    );
    const counts = new Map(teamCountsRes.rows.map((row) => [row.status, Number(row.total)]));
    widgets = {
      criticalTasks: summary.high,
      overdueTasks: summary.overdue,
      teamAvailability: counts.get('active') || 0,
      vacationCoverage: summary.conflicts,
      reassignedTasks: summary.reassigned,
      coverageTasks: tasks.filter((task) => task.conflict || task.reassignment_count > 0).length
    };
  }

  return { tasks, summary, widgets };
}

app.get('/health', async (_req, res) => {
  const result = await query<{ ok: number }>('SELECT 1 AS ok');
  res.json({ status: 'ok', db: result.rows[0]?.ok === 1 });
});

app.get('/api/dashboard', async (_req, res, next) => {
  try {
    res.json(await getDashboardPayload());
  } catch (error) {
    next(error);
  }
});

app.get('/api/categories/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid category id' });
      return;
    }

    const catRes = await query<{ id: number; name: string; icon: string; avatar: string; color_a: string; color_b: string }>(
      'SELECT id, name, icon, avatar, color_a, color_b FROM categories WHERE id = $1',
      [id]
    );

    if (!catRes.rows[0]) {
      res.status(404).json({ error: 'Category not found' });
      return;
    }

    const activityRes = await query<ActivityRow>(
      `SELECT id, category_id, tier, title, notes, priority, due_date::text, status, completed
       FROM activities
       WHERE category_id = $1
       ORDER BY tier, position`,
      [id]
    );

    const group = { foundation: [] as ActivityRow[], growth: [] as ActivityRow[], mastery: [] as ActivityRow[] };
    for (const activity of activityRes.rows) {
      if (activity.tier === 3) group.foundation.push(activity);
      else if (activity.tier === 6) group.growth.push(activity);
      else group.mastery.push(activity);
    }

    res.json({ category: catRes.rows[0], activities: group });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/activities/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = updateActivitySchema.safeParse(req.body);
    if (Number.isNaN(id) || !parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.success ? undefined : parsed.error.flatten() });
      return;
    }

    const unlocked = await withTransaction(async (client) => {
      const currentRes = await client.query<{ id: number; completed: boolean; tier: number }>(
        'SELECT id, completed, tier FROM activities WHERE id = $1 FOR UPDATE',
        [id]
      );
      const current = currentRes.rows[0];
      if (!current) {
        throw new Error('NOT_FOUND');
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [key, value] of Object.entries(parsed.data)) {
        fields.push(`${key} = $${idx}`);
        values.push(value);
        idx += 1;
      }

      if (parsed.data.completed === true) {
        fields.push(`completed_at = NOW()`);
        if (parsed.data.status === undefined) {
          fields.push(`status = 'done'`);
        }
      }
      if (parsed.data.completed === false) {
        fields.push(`completed_at = NULL`);
      }

      if (fields.length > 0) {
        values.push(id);
        await client.query(`UPDATE activities SET ${fields.join(', ')} WHERE id = $${idx}`, values);
      }

      if (parsed.data.completed === true && current.completed === false) {
        await client.query(
          'INSERT INTO xp_history (user_id, activity_id, xp) VALUES ($1, $2, $3)',
          [defaultUserId, id, xpForTier(current.tier)]
        );
      }

      if (parsed.data.completed === false && current.completed === true) {
        await client.query(
          'INSERT INTO xp_history (user_id, activity_id, xp) VALUES ($1, $2, $3)',
          [defaultUserId, id, -xpForTier(current.tier)]
        );
      }

      return refreshAchievements();
    });

    const updatedRes = await query<ActivityRow>(
      `SELECT id, category_id, tier, title, notes, priority, due_date::text, status, completed
       FROM activities WHERE id = $1`,
      [id]
    );

    res.json({ activity: updatedRes.rows[0], unlocked });
  } catch (error) {
    if ((error as Error).message === 'NOT_FOUND') {
      res.status(404).json({ error: 'Activity not found' });
      return;
    }
    next(error);
  }
});

app.get('/api/tasks', async (req, res, next) => {
  try {
    const taskType = req.query.task_type === 'personal' || req.query.task_type === 'professional' ? req.query.task_type : undefined;
    const severity = req.query.severity === 'high' || req.query.severity === 'medium' || req.query.severity === 'low' ? req.query.severity : undefined;
    const status =
      req.query.status === 'pending' || req.query.status === 'in_progress' || req.query.status === 'completed' ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    res.json(await getTasks(taskType, severity, status, q || undefined));
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const parsed = taskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid task payload', details: parsed.error.flatten() });
      return;
    }

    const payload = normalizeTaskPayload(parsed.data);
    await ensureCategoryExists(payload.category_id);
    await ensureTeamMemberExists(payload.assigned_to);

    const insertRes = await query<{ id: number }>(
      `INSERT INTO tasks (task_type, title, description, project_name, severity, status, due_date, end_date, due_time, assigned_to, category_id, notes, mandays)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        payload.task_type,
        payload.title,
        payload.description,
        payload.project_name,
        payload.severity,
        payload.status,
        payload.due_date,
        payload.end_date,
        payload.due_time,
        payload.assigned_to,
        payload.category_id,
        payload.notes,
        payload.mandays
      ]
    );

    const taskRes = await query<TaskRow>(
      `SELECT t.id,
              t.task_type,
              t.title,
              t.description,
              t.project_name,
              t.severity,
              t.status,
              t.due_date::text,
              t.end_date::text,
              TO_CHAR(t.due_time, 'HH24:MI') AS due_time,
              t.assigned_to,
              t.category_id,
              t.notes,
              t.mandays,
              t.created_at::text,
              t.updated_at::text,
              c.name AS category_name,
              tm.name AS assigned_name,
              tm.status AS team_member_status,
              EXISTS (
                SELECT 1
                FROM vacations v
                WHERE v.member_id = t.assigned_to
                  AND t.due_date IS NOT NULL
                  AND t.due_date BETWEEN v.start_date AND v.end_date
              ) AS has_conflict,
              0 AS reassignment_count
       FROM tasks t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN team_members tm ON tm.id = t.assigned_to
       WHERE t.id = $1`,
      [insertRes.rows[0].id]
    );

    res.status(201).json({ task: toTaskResponse(taskRes.rows[0]) });
  } catch (error) {
    if ((error as Error).message === 'CATEGORY_NOT_FOUND') {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    if ((error as Error).message === 'TEAM_MEMBER_NOT_FOUND') {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    next(error);
  }
});

app.put('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = taskSchema.safeParse(req.body);
    if (Number.isNaN(id) || !parsed.success) {
      res.status(400).json({ error: 'Invalid task payload', details: parsed.success ? undefined : parsed.error.flatten() });
      return;
    }

    const payload = normalizeTaskPayload(parsed.data);
    await ensureCategoryExists(payload.category_id);
    await ensureTeamMemberExists(payload.assigned_to);

    const updateRes = await query<TaskRow>(
      `UPDATE tasks
       SET task_type = $1,
           title = $2,
           description = $3,
           project_name = $4,
           severity = $5,
           status = $6,
           due_date = $7,
           end_date = $8,
           due_time = $9,
           assigned_to = $10,
           category_id = $11,
           notes = $12,
           mandays = $13,
           updated_at = NOW()
       WHERE id = $14
       RETURNING id,
                 task_type,
                 title,
                 description,
                 project_name,
                 severity,
                 status,
                 due_date::text,
                 end_date::text,
                 TO_CHAR(due_time, 'HH24:MI') AS due_time,
                 assigned_to,
                 category_id,
                 notes,
                 mandays,
                 created_at::text,
                 updated_at::text,
                 NULL::text AS category_name,
                 NULL::text AS assigned_name,
                 NULL::text AS team_member_status,
                 FALSE AS has_conflict,
                 0 AS reassignment_count`,
      [
        payload.task_type,
        payload.title,
        payload.description,
        payload.project_name,
        payload.severity,
        payload.status,
        payload.due_date,
        payload.end_date,
        payload.due_time,
        payload.assigned_to,
        payload.category_id,
        payload.notes,
        payload.mandays,
        id
      ]
    );

    if (!updateRes.rows[0]) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const taskRes = await query<TaskRow>(
      `SELECT t.id,
              t.task_type,
              t.title,
              t.description,
              t.project_name,
              t.severity,
              t.status,
              t.due_date::text,
              t.end_date::text,
              TO_CHAR(t.due_time, 'HH24:MI') AS due_time,
              t.assigned_to,
              t.category_id,
              t.notes,
              t.mandays,
              t.created_at::text,
              t.updated_at::text,
              c.name AS category_name,
              tm.name AS assigned_name,
              tm.status AS team_member_status,
              EXISTS (
                SELECT 1
                FROM vacations v
                WHERE v.member_id = t.assigned_to
                  AND t.due_date IS NOT NULL
                  AND t.due_date BETWEEN v.start_date AND v.end_date
              ) AS has_conflict,
              COALESCE((SELECT COUNT(*)::int FROM task_reassignments tr WHERE tr.task_id = t.id), 0) AS reassignment_count
       FROM tasks t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN team_members tm ON tm.id = t.assigned_to
       WHERE t.id = $1`,
      [id]
    );

    res.json({ task: toTaskResponse(taskRes.rows[0]) });
  } catch (error) {
    if ((error as Error).message === 'CATEGORY_NOT_FOUND') {
      res.status(404).json({ error: 'Category not found' });
      return;
    }
    if ((error as Error).message === 'TEAM_MEMBER_NOT_FOUND') {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    next(error);
  }
});

app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid task id' });
      return;
    }

    await query('DELETE FROM tasks WHERE id = $1', [id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/team-members', async (_req, res, next) => {
  try {
    await syncTeamMemberStatuses();
    const rows = await query(
      `SELECT id, name, email, role, status, created_at::text
       FROM team_members
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'vacation' THEN 1 ELSE 2 END, name ASC`
    );

    const summary = {
      active: rows.rows.filter((row) => row.status === 'active').length,
      vacation: rows.rows.filter((row) => row.status === 'vacation').length,
      archived: rows.rows.filter((row) => row.status === 'archived').length
    };

    res.json({ members: rows.rows, summary });
  } catch (error) {
    next(error);
  }
});

app.post('/api/team-members', async (req, res, next) => {
  try {
    const parsed = teamMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid team member payload', details: parsed.error.flatten() });
      return;
    }

    const payload = {
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      role: parsed.data.role.trim(),
      status: parsed.data.status
    };

    const insertRes = await query(
      `INSERT INTO team_members (name, email, role, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, status, created_at::text`,
      [payload.name, payload.email, payload.role, payload.status]
    );

    res.status(201).json({ member: insertRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/team-members/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = teamMemberSchema.safeParse(req.body);
    if (Number.isNaN(id) || !parsed.success) {
      res.status(400).json({ error: 'Invalid team member payload', details: parsed.success ? undefined : parsed.error.flatten() });
      return;
    }

    const payload = {
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      role: parsed.data.role.trim(),
      status: parsed.data.status
    };

    const updateRes = await query(
      `UPDATE team_members
       SET name = $1,
           email = $2,
           role = $3,
           status = $4
       WHERE id = $5
       RETURNING id, name, email, role, status, created_at::text`,
      [payload.name, payload.email, payload.role, payload.status, id]
    );

    if (!updateRes.rows[0]) {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }

    res.json({ member: updateRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/team-members/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid team member id' });
      return;
    }

    await query(`DELETE FROM team_members WHERE id = $1`, [id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/vacations', async (_req, res, next) => {
  try {
    await syncTeamMemberStatuses();
    const rows = await query(
      `SELECT v.id,
              v.member_id,
              tm.name AS member_name,
              v.start_date::text,
              v.end_date::text,
              v.reason,
              v.created_at::text
       FROM vacations v
       JOIN team_members tm ON tm.id = v.member_id
       ORDER BY v.start_date ASC, tm.name ASC`
    );
    res.json({ vacations: rows.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/vacations', async (req, res, next) => {
  try {
    const parsed = vacationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid vacation payload', details: parsed.error.flatten() });
      return;
    }

    await ensureTeamMemberExists(parsed.data.member_id);
    const insertRes = await query(
      `INSERT INTO vacations (member_id, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id, member_id, start_date::text, end_date::text, reason, created_at::text`,
      [parsed.data.member_id, parsed.data.start_date, parsed.data.end_date, parsed.data.reason.trim()]
    );
    await syncTeamMemberStatuses();
    res.status(201).json({ vacation: insertRes.rows[0] });
  } catch (error) {
    if ((error as Error).message === 'TEAM_MEMBER_NOT_FOUND') {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    next(error);
  }
});

app.put('/api/vacations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = vacationSchema.safeParse(req.body);
    if (Number.isNaN(id) || !parsed.success) {
      res.status(400).json({ error: 'Invalid vacation payload', details: parsed.success ? undefined : parsed.error.flatten() });
      return;
    }

    await ensureTeamMemberExists(parsed.data.member_id);
    const updateRes = await query(
      `UPDATE vacations
       SET member_id = $1,
           start_date = $2,
           end_date = $3,
           reason = $4
       WHERE id = $5
       RETURNING id, member_id, start_date::text, end_date::text, reason, created_at::text`,
      [parsed.data.member_id, parsed.data.start_date, parsed.data.end_date, parsed.data.reason.trim(), id]
    );

    if (!updateRes.rows[0]) {
      res.status(404).json({ error: 'Vacation not found' });
      return;
    }

    await syncTeamMemberStatuses();
    res.json({ vacation: updateRes.rows[0] });
  } catch (error) {
    if ((error as Error).message === 'TEAM_MEMBER_NOT_FOUND') {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    next(error);
  }
});

app.delete('/api/vacations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid vacation id' });
      return;
    }

    await query('DELETE FROM vacations WHERE id = $1', [id]);
    await syncTeamMemberStatuses();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/reassignments', async (_req, res, next) => {
  try {
    const rows = await query(
      `SELECT tr.id,
              tr.task_id,
              t.title AS task_title,
              tr.from_member,
              from_tm.name AS from_member_name,
              tr.to_member,
              to_tm.name AS to_member_name,
              tr.reason,
              tr.created_at::text
       FROM task_reassignments tr
       JOIN tasks t ON t.id = tr.task_id
       LEFT JOIN team_members from_tm ON from_tm.id = tr.from_member
       LEFT JOIN team_members to_tm ON to_tm.id = tr.to_member
       ORDER BY tr.created_at DESC`
    );
    res.json({ reassignments: rows.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/reassignments', async (req, res, next) => {
  try {
    const parsed = reassignmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reassignment payload', details: parsed.error.flatten() });
      return;
    }

    const result = await withTransaction(async (client) => {
      const taskRes = await client.query<{ id: number; task_type: TaskType; assigned_to: number | null }>(
        'SELECT id, task_type, assigned_to FROM tasks WHERE id = $1 FOR UPDATE',
        [parsed.data.task_id]
      );
      const task = taskRes.rows[0];
      if (!task) {
        throw new Error('TASK_NOT_FOUND');
      }
      if (task.task_type !== 'professional') {
        throw new Error('TASK_NOT_PROFESSIONAL');
      }

      const currentAssigned = task.assigned_to === null || task.assigned_to === undefined ? null : Number(task.assigned_to);
      const fromMember = parsed.data.from_member ?? currentAssigned;
      if (parsed.data.from_member !== undefined && parsed.data.from_member !== null && parsed.data.from_member !== currentAssigned) {
        throw new Error('REASSIGNMENT_CONFLICT');
      }

      if (fromMember !== null) {
        const fromRes = await client.query<{ id: number }>('SELECT id FROM team_members WHERE id = $1 AND status <> $2', [fromMember, 'archived']);
        if (!fromRes.rows[0]) {
          throw new Error('TEAM_MEMBER_NOT_FOUND');
        }
      }

      const toRes = await client.query<{ id: number }>('SELECT id FROM team_members WHERE id = $1 AND status <> $2', [parsed.data.to_member, 'archived']);
      if (!toRes.rows[0]) {
        throw new Error('TEAM_MEMBER_NOT_FOUND');
      }

      await client.query('UPDATE tasks SET assigned_to = $1, updated_at = NOW() WHERE id = $2', [parsed.data.to_member, parsed.data.task_id]);
      const insertRes = await client.query(
        `INSERT INTO task_reassignments (task_id, from_member, to_member, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id, task_id, from_member, to_member, reason, created_at::text`,
        [parsed.data.task_id, fromMember, parsed.data.to_member, parsed.data.reason.trim()]
      );

      return insertRes.rows[0];
    });

    res.status(201).json({ reassignment: result });
  } catch (error) {
    if ((error as Error).message === 'TASK_NOT_FOUND') {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if ((error as Error).message === 'TASK_NOT_PROFESSIONAL') {
      res.status(400).json({ error: 'Only professional tasks can be reassigned' });
      return;
    }
    if ((error as Error).message === 'TEAM_MEMBER_NOT_FOUND') {
      res.status(404).json({ error: 'Team member not found' });
      return;
    }
    if ((error as Error).message === 'REASSIGNMENT_CONFLICT') {
      res.status(409).json({ error: 'Task assignment changed before reassignment could be applied' });
      return;
    }
    next(error);
  }
});

// Team Tasks: returns all team members with their assigned professional tasks and mandays summary
app.get('/api/team-tasks', async (_req, res, next) => {
  try {
    const membersRes = await query<{ id: string; name: string; email: string; role: string; status: string }>(
      `SELECT id, name, email, role, status FROM team_members WHERE status <> 'archived' ORDER BY name ASC`
    );

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    const tasksRes = await query<{
      id: string; assigned_to: string; title: string; project_name: string | null;
      status: string; severity: string; due_date: string | null; end_date: string | null; mandays: string | null;
    }>(
      `SELECT id, assigned_to, title, project_name, status, severity,
              due_date::text, end_date::text, mandays
       FROM tasks
       WHERE task_type = 'professional' AND assigned_to IS NOT NULL
       ORDER BY due_date ASC NULLS LAST`
    );

    const members = membersRes.rows.map((m) => {
      const memberTasks = tasksRes.rows.filter((t) => String(t.assigned_to) === String(m.id));
      const totalMandays = memberTasks.reduce((sum, t) => sum + (t.mandays ? Number(t.mandays) : 0), 0);
      return {
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        totalMandays,
        currentMonth,
        tasks: memberTasks.map((t) => ({
          id: t.id,
          title: t.title,
          project_name: t.project_name,
          status: t.status,
          severity: t.severity,
          start_date: t.due_date,
          end_date: t.end_date,
          mandays: t.mandays ? Number(t.mandays) : null
        }))
      };
    });

    res.json({ members });
  } catch (error) {
    next(error);
  }
});

// Vacation calendar: returns all vacations with member color slot
app.get('/api/vacation-calendar', async (_req, res, next) => {
  try {
    const res2 = await query<{
      id: string; member_id: string; member_name: string; start_date: string; end_date: string; reason: string;
    }>(
      `SELECT v.id, v.member_id, tm.name AS member_name,
              v.start_date::text, v.end_date::text, v.reason
       FROM vacations v
       JOIN team_members tm ON tm.id = v.member_id
       ORDER BY v.start_date ASC`
    );

    // Assign consistent soft color slots based on member_id
    const colorPalette = [
      '#5b8dee','#8b5cf6','#ec4899','#14b8a6','#f59e0b',
      '#6366f1','#10b981','#f97316','#06b6d4','#a855f7'
    ];
    const memberColorMap = new Map<string, string>();
    let colorIdx = 0;
    res2.rows.forEach((v) => {
      if (!memberColorMap.has(v.member_id)) {
        memberColorMap.set(v.member_id, colorPalette[colorIdx % colorPalette.length]);
        colorIdx++;
      }
    });

    const vacations = res2.rows.map((v) => ({
      ...v,
      color: memberColorMap.get(v.member_id) || '#5b8dee'
    }));

    res.json({ vacations });
  } catch (error) {
    next(error);
  }
});

app.get('/api/focus-sessions', async (_req, res, next) => {
  try {
    const sessionsRes = await query(
      `SELECT id,
              duration_minutes,
              started_at::text,
              completed_at::text
       FROM focus_sessions
       ORDER BY started_at DESC
       LIMIT 100`
    );

    const statsRes = await query<{
      total_sessions: string;
      total_focus_time: string;
      daily_sessions: string;
      weekly_sessions: string;
    }>(
      `SELECT COUNT(*)::int AS total_sessions,
              COALESCE(SUM(duration_minutes), 0)::int AS total_focus_time,
              COUNT(*) FILTER (WHERE started_at >= date_trunc('day', NOW()))::int AS daily_sessions,
              COUNT(*) FILTER (WHERE started_at >= date_trunc('week', NOW()))::int AS weekly_sessions
       FROM focus_sessions`
    );

    res.json({
      sessions: sessionsRes.rows,
      stats: {
        totalSessions: Number(statsRes.rows[0]?.total_sessions || 0),
        totalFocusTime: Number(statsRes.rows[0]?.total_focus_time || 0),
        dailySessions: Number(statsRes.rows[0]?.daily_sessions || 0),
        weeklySessions: Number(statsRes.rows[0]?.weekly_sessions || 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/focus-sessions', async (req, res, next) => {
  try {
    const parsed = focusSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid focus session payload', details: parsed.error.flatten() });
      return;
    }

    const insertRes = await query(
      `INSERT INTO focus_sessions (duration_minutes, started_at, completed_at)
       VALUES ($1, $2, $3)
       RETURNING id, duration_minutes, started_at::text, completed_at::text`,
      [parsed.data.duration_minutes, parsed.data.started_at, parsed.data.completed_at]
    );

    res.status(201).json({ session: insertRes.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/life-category/planner', async (req, res, next) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : dayjs().format('YYYY-MM-DD');

    const row = await query<{ morning: string[]; afternoon: string[]; night: string[] }>(
      `SELECT morning, afternoon, night
       FROM planner_entries
       WHERE user_id = $1 AND plan_date = $2`,
      [defaultUserId, date]
    );

    res.json({
      date,
      morning: row.rows[0]?.morning || ['', '', ''],
      afternoon: row.rows[0]?.afternoon || ['', '', '', '', '', ''],
      night: row.rows[0]?.night || ['', '', '', '', '', '', '', '', '']
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/life-category/planner', async (req, res, next) => {
  try {
    const parsed = plannerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid planner data', details: parsed.error.flatten() });
      return;
    }

    const { date, morning, afternoon, night } = parsed.data;
    await query(
      `INSERT INTO planner_entries (user_id, plan_date, morning, afternoon, night)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       ON CONFLICT (user_id, plan_date)
       DO UPDATE SET morning = EXCLUDED.morning,
                     afternoon = EXCLUDED.afternoon,
                     night = EXCLUDED.night,
                     updated_at = NOW()`,
      [defaultUserId, date, JSON.stringify(morning), JSON.stringify(afternoon), JSON.stringify(night)]
    );

    res.json({ status: 'saved' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/life-category/planner', async (req, res, next) => {
  try {
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : dayjs().format('YYYY-MM-DD');

    await query(
      `DELETE FROM planner_entries
       WHERE user_id = $1 AND plan_date = $2`,
      [defaultUserId, date]
    );

    res.json({ status: 'deleted', date });
  } catch (error) {
    next(error);
  }
});

app.get('/api/life-category/planner/history', async (req, res, next) => {
  try {
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 8;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 30) : 8;

    const rows = await query<{ plan_date: string }>(
      `SELECT plan_date::text
       FROM planner_entries
       WHERE user_id = $1
       ORDER BY plan_date DESC
       LIMIT $2`,
      [defaultUserId, limit]
    );

    res.json({ dates: rows.rows.map((r) => r.plan_date) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/progress/charts', async (_req, res, next) => {
  try {
    const dailyRes = await query<{ d: string; count: string }>(
      `SELECT DATE(completed_at)::text AS d, COUNT(*)::int AS count
       FROM activities
       WHERE completed = TRUE AND completed_at >= NOW() - INTERVAL '14 day'
       GROUP BY DATE(completed_at)
       ORDER BY d ASC`
    );

    const dailyMap = new Map(dailyRes.rows.map((r) => [r.d, Number(r.count)]));
    const labels: string[] = [];
    const values: number[] = [];

    for (let i = 13; i >= 0; i -= 1) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      labels.push(dayjs(d).format('DD MMM'));
      values.push(dailyMap.get(d) || 0);
    }

    const catRes = await query<{ name: string; done: string; total: string }>(
      `SELECT c.name,
              COUNT(*) FILTER (WHERE a.completed = TRUE)::int AS done,
              COUNT(*)::int AS total
       FROM categories c
       JOIN activities a ON a.category_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    );

    res.json({
      activityTrend: { labels, values },
      categoryProgress: catRes.rows.map((r) => ({
        name: r.name,
        value: Number(r.total) > 0 ? Math.round((Number(r.done) / Number(r.total)) * 100) : 0
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/completed-tasks', async (_req, res, next) => {
  try {
    const personalProfessionalRes = await query<{
      id: number;
      task_type: TaskType;
      title: string;
      project_name: string | null;
      assigned_name: string | null;
      updated_at: string;
    }>(
      `SELECT t.id,
              t.task_type,
              t.title,
              t.project_name,
              tm.name AS assigned_name,
              t.updated_at::text
       FROM tasks t
       LEFT JOIN team_members tm ON tm.id = t.assigned_to
       WHERE t.status = 'completed'
       ORDER BY t.updated_at DESC`
    );

    const lifeRes = await query<{
      id: number;
      title: string;
      category_name: string;
      completed_at: string;
    }>(
      `SELECT a.id,
              a.title,
              c.name AS category_name,
              a.completed_at::text
       FROM activities a
       JOIN categories c ON c.id = a.category_id
       WHERE a.completed = TRUE AND a.completed_at IS NOT NULL
       ORDER BY a.completed_at DESC`
    );

    const items = [
      ...personalProfessionalRes.rows.map((row) => ({
        module: row.task_type === 'personal' ? 'Personal Task' : 'Professional Task',
        title: row.title,
        completed_at: row.updated_at,
        meta: row.task_type === 'professional'
          ? `Project: ${row.project_name || 'N/A'} • Assigned: ${row.assigned_name || 'Unassigned'}`
          : 'Task completed'
      })),
      ...lifeRes.rows.map((row) => ({
        module: 'Life Category Task',
        title: row.title,
        completed_at: row.completed_at,
        meta: `Category: ${row.category_name}`
      }))
    ].sort((a, b) => dayjs(b.completed_at).valueOf() - dayjs(a.completed_at).valueOf());

    res.json({
      items,
      stats: {
        personal: personalProfessionalRes.rows.filter((row) => row.task_type === 'personal').length,
        professional: personalProfessionalRes.rows.filter((row) => row.task_type === 'professional').length,
        lifeCategory: lifeRes.rows.length,
        total: items.length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/settings', async (_req, res, next) => {
  try {
    const row = await query<{ theme: string }>('SELECT theme FROM settings WHERE user_id = $1', [defaultUserId]);
    res.json({ theme: row.rows[0]?.theme || 'dark' });
  } catch (error) {
    next(error);
  }
});

app.put('/api/settings', async (req, res, next) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings payload', details: parsed.error.flatten() });
      return;
    }

    await query(
      `INSERT INTO settings (user_id, theme)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET theme = EXCLUDED.theme, updated_at = NOW()`,
      [defaultUserId, parsed.data.theme]
    );
    res.json({ status: 'saved' });
  } catch (error) {
    next(error);
  }
});

app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(error);
  res.status(500).json({ error: message });
});

async function bootstrap() {
  await ensureSeedData();
  await ensureTaskManagementSchema();
  await refreshAchievements();
  await syncTeamMemberStatuses();
  app.listen(port, host, () => {
    console.log(`Task369 server running at http://${host}:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start app:', error);
  process.exit(1);
});
