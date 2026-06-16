const state = {
  dashboard: null,
  selectedCategory: null,
  plannerDate: new Date().toISOString().slice(0, 10),
  plannerTitle: '',
  charts: { trend: null, category: null },
  dashboardTab: 'personal',
  professionalTab: 'team',
  taskSeverityFilter: {
    personal: '',
    professional: ''
  },
  personalTasks: [],
  professionalTasks: [],
  professionalTasksAll: [],
  teamMembersData: null,
  teamMembers: [],
  vacations: [],
  reassignments: [],
  editingPersonalTaskId: null,
  editingProfessionalTaskId: null,
  editingTaskId: null,
  editingTaskType: null,
  editingTeamMemberId: null,
  editingVacationId: null,
  focus: {
    durationMinutes: 25,
    remainingSeconds: 25 * 60,
    running: false,
    paused: false,
    timerHandle: null,
    startedAt: null
  }
};

const viewMeta = {
  dashboard: ['Dashboard', 'Build your life with the 3-6-9 rhythm.'],
  personalTasks: ['Personal Tasks', 'Manage personal tasks with calendar and priority filters.'],
  professionalTasks: ['Professional Tasks', 'Manage professional tasks with ownership and deadlines.'],
  teamTasks: ['Team Tasks', 'View all team members, their assigned tasks, and manday breakdown.'],
  lifeCategory: ['Life Category', 'Life tasks with integrated 3-6-9 planning.'],
  planner369: ['369 Planner', 'Dedicated 3-6-9 planner with flash cards and task drill-down.'],
  completedTasks: ['Completed Tasks', 'Track completed personal, professional, and life category work.'],
  professional: ['Professional', 'Team Members, Vacation Calendar, and Reassignments.'],
  focus: ['Focus Timer', 'Deep work sessions with local-first tracking.'],
  settings: ['Theme System', 'Dark, Light, Anime, and Cyberpunk styles.']
};

const menu = document.getElementById('menu');
const categoryGrid = document.getElementById('categoryGrid');
const plannerFlashGrid = document.getElementById('plannerFlashGrid');
const drawer = document.getElementById('detailDrawer');
const drawerHeader = document.getElementById('drawerHeader');
const activityGroups = document.getElementById('activityGroups');
const closeDrawer = document.getElementById('closeDrawer');
const toast = document.getElementById('toast');
const taskEditorModal = document.getElementById('taskEditorModal');
const taskEditorForm = document.getElementById('taskEditorForm');
const closeTaskEditorModal = document.getElementById('closeTaskEditorModal');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'API request failed');
  }
  if (response.status === 204) return null;
  return response.json();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function switchView(view) {
  document.querySelectorAll('.menu-btn').forEach((btn) => btn.classList.remove('active'));
  if (view === 'dashboard') {
    const dashboardBtn = document.querySelector('.menu-btn[data-view="dashboard"]:not([data-dashboard-tab-target])');
    if (dashboardBtn) dashboardBtn.classList.add('active');
  } else {
    document.querySelectorAll('.menu-btn').forEach((btn) => {
      if (btn.dataset.view === view) btn.classList.add('active');
    });
  }
  document.querySelectorAll('.view').forEach((panel) => panel.classList.remove('active'));
  document.getElementById(`${view}View`).classList.add('active');
  const [title, subtitle] = viewMeta[view];
  document.getElementById('viewTitle').textContent = title;
  document.getElementById('viewSubtitle').textContent = subtitle;
}

function setTaskSeverityFilter(taskType, severity) {
  state.taskSeverityFilter[taskType] = severity;
  document.querySelectorAll(`.priority-btn[data-task-type="${taskType}"]`).forEach((btn) => {
    btn.classList.toggle('active', (btn.dataset.priority || '') === severity);
  });
}

function switchProfessionalTab(tab) {
  state.professionalTab = tab;
  document.querySelectorAll('[data-professional-tab]').forEach((btn) => btn.classList.toggle('active', btn.dataset.professionalTab === tab));
  document.getElementById('professionalTeamPanel').classList.toggle('active', tab === 'team');
  document.getElementById('professionalVacationPanel').classList.toggle('active', tab === 'vacation');
  document.getElementById('professionalReassignPanel').classList.toggle('active', tab === 'reassignments');
}

function renderCategoryCards(categories, targetGrid) {
  if (!targetGrid) return;
  targetGrid.innerHTML = '';
  categories.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'category-card';
    card.style.animation = `fadeSlide 0.35s ease ${i * 0.02}s both`;
    card.style.borderColor = `${cat.colorA}55`;
    card.innerHTML = `
      <div class="card-head">
        <div class="avatar">${cat.avatar}</div>
        <div>${cat.icon}</div>
      </div>
      <h3>${cat.name}</h3>
      <p class="muted">${cat.done}/${cat.total} complete • ${cat.status}</p>
      <div class="progress-track"><div class="progress-value" style="width:${cat.progress}%;background:linear-gradient(90deg,${cat.colorA},${cat.colorB});"></div></div>
      <p>${cat.progress}%</p>
    `;
    card.addEventListener('click', () => openCategory(cat.id));
    targetGrid.appendChild(card);
  });
}

function updateHeaderStats(totals) {
  document.getElementById('overallProgress').textContent = `${totals.percent}% complete`;
  document.getElementById('levelName').textContent = totals.level;
  document.getElementById('xpTotal').textContent = `${totals.xp} XP`;
  document.getElementById('dailyStreak').textContent = totals.streaks.daily;
  document.getElementById('weeklyStreak').textContent = totals.streaks.weekly;
  document.getElementById('monthlyStreak').textContent = totals.streaks.monthly;
}

function makeActivityRow(activity) {
  const item = document.createElement('div');
  item.className = 'activity-item';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = activity.completed;

  const body = document.createElement('div');
  body.innerHTML = `<strong>${activity.title}</strong><br/><small>${activity.tier}-Tier Activity</small>`;

  const controls = document.createElement('div');
  controls.className = 'activity-controls';
  controls.innerHTML = `
    <select>
      <option value="low" ${activity.priority === 'low' ? 'selected' : ''}>Low</option>
      <option value="medium" ${activity.priority === 'medium' ? 'selected' : ''}>Medium</option>
      <option value="high" ${activity.priority === 'high' ? 'selected' : ''}>High</option>
      <option value="critical" ${activity.priority === 'critical' ? 'selected' : ''}>Critical</option>
    </select>
    <select>
      <option value="pending" ${activity.status === 'pending' ? 'selected' : ''}>Pending</option>
      <option value="in_progress" ${activity.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
      <option value="done" ${activity.status === 'done' ? 'selected' : ''}>Done</option>
      <option value="blocked" ${activity.status === 'blocked' ? 'selected' : ''}>Blocked</option>
    </select>
  `;

  const extras = document.createElement('div');
  extras.className = 'activity-controls';
  const due = document.createElement('input');
  due.type = 'date';
  due.value = activity.due_date || '';
  const note = document.createElement('textarea');
  note.rows = 2;
  note.value = activity.notes || '';
  note.placeholder = 'Notes';
  extras.append(due, note);

  const [prioritySelect, statusSelect] = controls.querySelectorAll('select');

  const persist = async (payload) => {
    try {
      const result = await api(`/api/activities/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (result.unlocked && result.unlocked.length) {
        showToast(`Achievement unlocked: ${result.unlocked.join(', ')}`);
      }
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    }
  };

  checkbox.addEventListener('change', () => persist({ completed: checkbox.checked }));
  prioritySelect.addEventListener('change', () => persist({ priority: prioritySelect.value }));
  statusSelect.addEventListener('change', () => persist({ status: statusSelect.value }));
  due.addEventListener('change', () => persist({ due_date: due.value || null }));
  note.addEventListener('blur', () => persist({ notes: note.value }));

  item.append(checkbox, body, controls, extras);
  return item;
}

async function openCategory(id) {
  const data = await api(`/api/categories/${id}`);
  state.selectedCategory = data;
  drawerHeader.innerHTML = `<h2>${data.category.icon} ${data.category.name}</h2><p class="muted">${data.category.avatar} Foundation 3 • Growth 6 • Mastery 9</p>`;
  activityGroups.innerHTML = '';

  const sections = [
    ['Foundation (3)', data.activities.foundation],
    ['Growth (6)', data.activities.growth],
    ['Mastery (9)', data.activities.mastery]
  ];

  sections.forEach(([title, list]) => {
    const group = document.createElement('div');
    group.className = 'activity-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    group.appendChild(heading);
    list.forEach((activity) => group.appendChild(makeActivityRow(activity)));
    activityGroups.appendChild(group);
  });

  drawer.classList.add('open');
}

function makeInputLines(containerId, count) {
  const root = document.getElementById(containerId);
  if (!root) return [];
  root.innerHTML = '';
  const inputs = [];
  for (let i = 0; i < count; i += 1) {
    const input = document.createElement('input');
    input.className = 'input-line';
    input.placeholder = `${i + 1}. item`;
    root.appendChild(input);
    inputs.push(input);
  }
  return inputs;
}

const plannerInputs = {
  morning: makeInputLines('morningList369', 3),
  afternoon: makeInputLines('afternoonList369', 6),
  night: makeInputLines('nightList369', 9)
};

const plannerTitleInput = document.getElementById('plannerTitle');
const plannerHistorySelect = document.getElementById('plannerHistorySelect');

const plannerSections = [
  { key: 'morning', title: 'Morning 3', goal: 3, containerId: 'morningList369' },
  { key: 'afternoon', title: 'Afternoon 6', goal: 6, containerId: 'afternoonList369' },
  { key: 'night', title: 'Night 9', goal: 9, containerId: 'nightList369' }
];

function plannerTitleStorageKey() {
  return `planner_title_${state.plannerDate}`;
}

function formatPlannerDateLabel(isoDate) {
  const dt = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function renderPlannerHistory(dates) {
  if (!plannerHistorySelect) return;

  plannerHistorySelect.innerHTML = '<option value="">Select date</option>';
  dates.forEach((dateValue) => {
    const opt = document.createElement('option');
    opt.value = dateValue;
    opt.textContent = formatPlannerDateLabel(dateValue);
    plannerHistorySelect.appendChild(opt);
  });

  if (dates.includes(state.plannerDate)) {
    plannerHistorySelect.value = state.plannerDate;
  }
}

async function loadPlannerHistory() {
  const data = await api('/api/life-category/planner/history?limit=8');
  renderPlannerHistory(data.dates || []);
}

function filledCount(list) {
  return list.filter((item) => item && item.trim()).length;
}

function focusPlannerSection(containerId) {
  const section = document.getElementById(containerId);
  if (!section) return;
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const firstInput = section.querySelector('input');
  if (firstInput) firstInput.focus();
}

function renderPlannerFlashCards(data) {
  if (!plannerFlashGrid) return;

  plannerFlashGrid.innerHTML = '';
  plannerSections.forEach((section, index) => {
    const items = data?.[section.key] || [];
    const done = filledCount(items);

    const card = document.createElement('article');
    card.className = 'planner-flash-card';
    card.style.animation = `fadeSlide 0.35s ease ${index * 0.04}s both`;
    card.innerHTML = `
      <h4>${section.title}</h4>
      <div class="planner-flash-count">${done}/${section.goal}</div>
      <p class="planner-flash-caption">${section.goal - done} remaining tasks</p>
    `;
    card.addEventListener('click', () => focusPlannerSection(section.containerId));
    plannerFlashGrid.appendChild(card);
  });
}

async function loadPlanner() {
  const data = await api(`/api/life-category/planner?date=${state.plannerDate}`);
  plannerInputs.morning.forEach((el, i) => (el.value = data.morning[i] || ''));
  plannerInputs.afternoon.forEach((el, i) => (el.value = data.afternoon[i] || ''));
  plannerInputs.night.forEach((el, i) => (el.value = data.night[i] || ''));
  renderPlannerFlashCards(data);
  const savedTitle = localStorage.getItem(plannerTitleStorageKey()) || '';
  state.plannerTitle = savedTitle;
  if (plannerTitleInput) plannerTitleInput.value = savedTitle;
  const plannerDateEl = document.getElementById('planner369Date');
  if (plannerDateEl) plannerDateEl.value = state.plannerDate;
}

async function savePlanner() {
  await api('/api/life-category/planner', {
    method: 'PUT',
    body: JSON.stringify({
      date: state.plannerDate,
      morning: plannerInputs.morning.map((x) => x.value.trim()),
      afternoon: plannerInputs.afternoon.map((x) => x.value.trim()),
      night: plannerInputs.night.map((x) => x.value.trim())
    })
  });
  if (plannerTitleInput) {
    state.plannerTitle = plannerTitleInput.value.trim();
    localStorage.setItem(plannerTitleStorageKey(), state.plannerTitle);
  }
  renderPlannerFlashCards({
    morning: plannerInputs.morning.map((x) => x.value.trim()),
    afternoon: plannerInputs.afternoon.map((x) => x.value.trim()),
    night: plannerInputs.night.map((x) => x.value.trim())
  });
  await loadPlannerHistory();
  showToast('Planner saved');
}

async function deletePlanner() {
  const yes = window.confirm(`Delete planner for ${state.plannerDate}?`);
  if (!yes) return;

  await api(`/api/life-category/planner?date=${encodeURIComponent(state.plannerDate)}`, { method: 'DELETE' });

  plannerInputs.morning.forEach((el) => (el.value = ''));
  plannerInputs.afternoon.forEach((el) => (el.value = ''));
  plannerInputs.night.forEach((el) => (el.value = ''));
  if (plannerTitleInput) plannerTitleInput.value = '';
  localStorage.removeItem(plannerTitleStorageKey());
  state.plannerTitle = '';

  renderPlannerFlashCards({ morning: [], afternoon: [], night: [] });
  await loadPlannerHistory();
  showToast('Planner deleted');
}

function severityColorClass(severity) {
  if (severity === 'high') return 'sev-high';
  if (severity === 'medium') return 'sev-medium';
  return 'sev-low';
}

function statusLabel(status) {
  if (status === 'in_progress') return 'In Progress';
  if (status === 'completed') return 'Completed';
  return 'Pending';
}

function taskFormPayload(prefix, taskType) {
  return {
    task_type: taskType,
    title: document.getElementById(`${prefix}Title`).value.trim(),
    description: document.getElementById(`${prefix}Description`).value.trim(),
    project_name: taskType === 'professional' ? document.getElementById('professionalProject').value.trim() || null : null,
    severity: document.getElementById(`${prefix}Severity`).value,
    status: document.getElementById(`${prefix}Status`).value,
    due_date: document.getElementById(`${prefix}DueDate`).value || null,
    end_date: document.getElementById(`${prefix}EndDate`) ? (document.getElementById(`${prefix}EndDate`).value || null) : null,
    due_time: document.getElementById(`${prefix}DueTime`).value || null,
    assigned_to: taskType === 'professional' ? Number(document.getElementById('professionalAssignedTo').value) || null : null,
    category_id: taskType === 'personal' ? Number(document.getElementById('personalCategory').value) || null : null,
    mandays: document.getElementById(`${prefix}Mandays`) ? (parseFloat(document.getElementById(`${prefix}Mandays`).value) || null) : null,
    notes: document.getElementById(`${prefix}Notes`).value.trim()
  };
}

function resetTaskSearchAndFilters(taskType) {
  const searchInput = document.getElementById('dashboardTaskSearch');
  if (searchInput) {
    searchInput.value = '';
  }
  setTaskSeverityFilter(taskType, '');
}

function resetTaskForm(prefix, taskType) {
  document.getElementById(`${prefix}Title`).value = '';
  document.getElementById(`${prefix}Description`).value = '';
  document.getElementById(`${prefix}Severity`).value = 'medium';
  document.getElementById(`${prefix}Status`).value = 'pending';
  document.getElementById(`${prefix}DueDate`).value = '';
  if (document.getElementById(`${prefix}EndDate`)) document.getElementById(`${prefix}EndDate`).value = '';
  document.getElementById(`${prefix}DueTime`).value = '';
  if (document.getElementById(`${prefix}Mandays`)) document.getElementById(`${prefix}Mandays`).value = '';
  document.getElementById(`${prefix}Notes`).value = '';

  if (taskType === 'personal') {
    const categorySelect = document.getElementById('personalCategory');
    if (categorySelect.options.length > 0) categorySelect.selectedIndex = 0;
    state.editingPersonalTaskId = null;
  }

  if (taskType === 'professional') {
    document.getElementById('professionalProject').value = '';
    const memberSelect = document.getElementById('professionalAssignedTo');
    memberSelect.value = '';
    state.editingProfessionalTaskId = null;
  }
}

function fillTaskForm(prefix, task) {
  document.getElementById(`${prefix}Title`).value = task.title || '';
  document.getElementById(`${prefix}Description`).value = task.description || '';
  document.getElementById(`${prefix}Severity`).value = task.severity || 'medium';
  document.getElementById(`${prefix}Status`).value = task.status || 'pending';
  document.getElementById(`${prefix}DueDate`).value = task.due_date || '';
  if (document.getElementById(`${prefix}EndDate`)) document.getElementById(`${prefix}EndDate`).value = task.end_date || '';
  document.getElementById(`${prefix}DueTime`).value = task.due_time || '';
  if (document.getElementById(`${prefix}Mandays`)) document.getElementById(`${prefix}Mandays`).value = task.mandays != null ? String(task.mandays) : '';
  document.getElementById(`${prefix}Notes`).value = task.notes || '';
}

function openTaskEditor(task, taskType) {
  state.editingTaskId = task.id;
  state.editingTaskType = taskType;

  document.getElementById('editTaskTitle').value = task.title || '';
  document.getElementById('editTaskDescription').value = task.description || '';
  document.getElementById('editTaskSeverity').value = task.severity || 'medium';
  document.getElementById('editTaskStatus').value = task.status || 'pending';
  document.getElementById('editTaskDueDate').value = task.due_date || '';
  document.getElementById('editTaskEndDate').value = task.end_date || '';
  document.getElementById('editTaskDueTime').value = task.due_time || '';
  document.getElementById('editTaskMandays').value = task.mandays != null ? String(task.mandays) : '';
  document.getElementById('editTaskNotes').value = task.notes || '';
  document.getElementById('editTaskProject').value = task.project_name || '';
  document.getElementById('editTaskAssignedTo').value = String(task.assigned_to || '');
  document.getElementById('editTaskCategory').value = String(task.category_id || '');

  const categoryWrap = document.getElementById('editTaskCategoryWrap');
  const projectWrap = document.getElementById('editTaskProjectWrap');
  const assignedWrap = document.getElementById('editTaskAssignedWrap');

  categoryWrap.style.display = taskType === 'personal' ? 'block' : 'none';
  projectWrap.style.display = taskType === 'professional' ? 'block' : 'none';
  assignedWrap.style.display = taskType === 'professional' ? 'block' : 'none';

  taskEditorModal.classList.add('open');
}

function closeTaskEditor() {
  taskEditorModal.classList.remove('open');
  state.editingTaskId = null;
  state.editingTaskType = null;
}

function isTaskDueToday(task) {
  if (!task.due_date) return false;
  const today = new Date();
  const due = new Date(task.due_date);
  return due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() && due.getDate() === today.getDate();
}

function isTaskBacklog(task) {
  if (task.status === 'completed') return false;
  if (!task.due_date) return true;
  const due = new Date(task.due_date);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return due < todayStart;
}

function taskListItem(task, taskType) {
  const item = document.createElement('div');
  item.className = `journal-item dashboard-task-item ${task.status === 'completed' ? 'task-completed' : ''}`;
  item.innerHTML = `
    <strong>${task.title}</strong>
    <p class="muted">${taskType === 'professional' ? (task.project_name || 'No project') : (task.category_name || 'No category')}</p>
    <p class="muted">${task.due_date || 'No due date'} ${task.due_time || ''}</p>
  `;
  item.addEventListener('click', () => openTaskEditor(task, taskType));
  return item;
}

function renderDashboardTaskBlocks() {
  const todayRoot = document.getElementById('todayTaskList');
  const backlogRoot = document.getElementById('backlogTaskList');
  if (!todayRoot || !backlogRoot) return;

  const personalAll = state.personalTasksAll || [];
  const professionalAll = state.professionalTasksAll || [];
  const combined = [
    ...personalAll.map((task) => ({ task, taskType: 'personal' })),
    ...professionalAll.map((task) => ({ task, taskType: 'professional' }))
  ];

  const todayItems = combined.filter((entry) => isTaskDueToday(entry.task) && entry.task.status !== 'completed');
  const backlogItems = combined.filter((entry) => isTaskBacklog(entry.task));

  todayRoot.innerHTML = '';
  backlogRoot.innerHTML = '';

  if (todayItems.length === 0) {
    todayRoot.innerHTML = '<p class="muted">No tasks due today.</p>';
  } else {
    todayItems.forEach((entry) => todayRoot.appendChild(taskListItem(entry.task, entry.taskType)));
  }

  if (backlogItems.length === 0) {
    backlogRoot.innerHTML = '<p class="muted">No backlog tasks.</p>';
  } else {
    backlogItems.forEach((entry) => backlogRoot.appendChild(taskListItem(entry.task, entry.taskType)));
  }
}

function weekNumberFromDate(input) {
  const date = new Date(input);
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
}

function startOfWeek(date) {
  const start = new Date(date);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function formatDayMonth(date) {
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

function groupTasksByWeek(tasks) {
  const grouped = new Map();

  tasks.forEach((task) => {
    const base = task.due_date ? new Date(task.due_date) : new Date(task.created_at || Date.now());
    const weekStart = startOfWeek(base);
    const weekNum = weekNumberFromDate(weekStart);
    const weekKey = `${weekStart.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

    if (!grouped.has(weekKey)) {
      const weekEnd = addDays(weekStart, 6);
      grouped.set(weekKey, {
        weekLabel: `Week ${weekNum} • ${formatDayMonth(weekStart)} - ${formatDayMonth(weekEnd)}`,
        days: {
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
          Saturday: [],
          Sunday: []
        }
      });
    }

    const dayName = (task.due_date ? new Date(task.due_date) : base).toLocaleDateString('en-US', { weekday: 'long' });
    const mapped = dayName === 'Monday' || dayName === 'Tuesday' || dayName === 'Wednesday' || dayName === 'Thursday' || dayName === 'Friday' || dayName === 'Saturday' || dayName === 'Sunday' ? dayName : 'Monday';
    grouped.get(weekKey).days[mapped].push(task);
  });

  return Array.from(grouped.values());
}

function timelineTaskCard(task, type) {
  const item = document.createElement('article');
  item.className = `timeline-task ${severityColorClass(task.severity)} ${task.status === 'completed' ? 'is-complete' : ''} ${task.conflict ? 'has-conflict' : ''} ${task.overdue ? 'is-overdue' : ''}`;
  const when = [task.due_date || 'No date', task.due_time || ''].join(' ').trim();
  const isCompleted = task.status === 'completed';
  item.innerHTML = `
    <div class="meeting-top-row">
      <span class="complete-chip ${isCompleted ? 'done' : ''}">${isCompleted ? '✓' : ''}</span>
      <span class="meeting-time">${when}</span>
      <span class="task-status">${statusLabel(task.status)}</span>
    </div>
    <strong class="meeting-title">${task.title}</strong>
    ${type === 'professional' ? `<p class="muted">${task.project_name || 'No project'} • ${task.assigned_name || 'Unassigned'}</p>` : `<p class="muted">${task.category_name || 'No category'}</p>`}
    <p class="muted">Priority: ${task.severity}</p>
    ${task.conflict ? '<div class="conflict-badge">Assigned employee is on vacation.</div>' : ''}
    <div class="form-actions">
      <button class="task-action-btn action-complete" data-action="complete">${isCompleted ? 'Completed' : 'Mark Complete'}</button>
      <button class="ghost" data-action="delete">Delete</button>
    </div>
  `;

  item.querySelector('[data-action="complete"]').addEventListener('click', async () => {
    if (isCompleted) {
      const confirmUndo = window.confirm('Are you sure you want undo chnages');
      if (!confirmUndo) return;
    }

    const payload = {
      ...task,
      status: isCompleted ? 'pending' : 'completed',
      task_type: type
    };

    await api(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast(isCompleted ? 'Task moved back to pending' : 'Task marked complete');
    await loadTaskData();
  });

  item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    showToast('Task deleted');
    await loadTaskData();
  });

  item.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    openTaskEditor(task, type);
  });

  return item;
}

function renderTimeline(tasks, rootId, type) {
  const root = document.getElementById(rootId);
  root.innerHTML = '';

  const grouped = groupTasksByWeek(tasks);
  if (!grouped.length) {
    root.innerHTML = '<p class="muted">No tasks found for current filters.</p>';
    return;
  }

  grouped.forEach((week) => {
    const weekBlock = document.createElement('section');
    weekBlock.className = 'timeline-week';
    weekBlock.innerHTML = `<h4>${week.weekLabel}</h4>`;

    const dayGrid = document.createElement('div');
    dayGrid.className = 'timeline-week-grid';
    Object.entries(week.days).forEach(([dayName, dayTasks]) => {
      const dayCol = document.createElement('div');
      dayCol.className = 'timeline-day';
      dayCol.innerHTML = `<h5>${dayName}</h5>`;

      if (dayTasks.length === 0) {
        dayCol.innerHTML += '<p class="muted">No tasks</p>';
      } else {
        dayTasks.forEach((task) => dayCol.appendChild(timelineTaskCard(task, type)));
      }

      dayGrid.appendChild(dayCol);
    });

    weekBlock.appendChild(dayGrid);
    root.appendChild(weekBlock);
  });
}

function renderSummaryCards(summary, rootId) {
  const root = document.getElementById(rootId);
  root.innerHTML = '';

  const cards = [
    { label: 'High Priority', value: summary.high || 0, cls: 'summary-high' },
    { label: 'Medium Priority', value: summary.medium || 0, cls: 'summary-medium' },
    { label: 'Low Priority', value: summary.low || 0, cls: 'summary-low' },
    { label: 'Completed', value: summary.completed || 0, cls: '' }
  ];

  cards.forEach((card) => {
    const el = document.createElement('article');
    el.className = `summary-card ${card.cls}`;
    el.innerHTML = `<p>${card.label}</p><h4>${card.value}</h4>`;
    root.appendChild(el);
  });
}

function renderProfessionalWidgets(widgets) {
  const root = document.getElementById('professionalWidgetCards');
  root.innerHTML = '';

  const items = [
    ['Critical Tasks', widgets.criticalTasks || 0],
    ['Overdue Tasks', widgets.overdueTasks || 0],
    ['Team Availability', widgets.teamAvailability || 0],
    ['Vacation Coverage', widgets.vacationCoverage || 0],
    ['Reassigned Tasks', widgets.reassignedTasks || 0],
    ['Coverage Tasks', widgets.coverageTasks || 0]
  ];

  items.forEach(([label, value]) => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    card.innerHTML = `<p>${label}</p><h4>${value}</h4>`;
    root.appendChild(card);
  });
}

async function loadTasks(type, options = {}) {
  const severity = options.ignoreSeverity ? '' : state.taskSeverityFilter[type] || '';
  const queryText = options.ignoreSearch ? '' : (document.getElementById('dashboardTaskSearch')?.value || '').trim();
  const params = new URLSearchParams({ task_type: type });
  if (severity) params.set('severity', severity);
  if (queryText) params.set('q', queryText);

  return api(`/api/tasks?${params.toString()}`);
}

function populateCategoryOptions() {
  const targets = ['personalCategory', 'editTaskCategory'];
  targets.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = '<option value="">Select Category</option>';
    (state.dashboard?.categories || []).forEach((cat) => {
      const option = document.createElement('option');
      option.value = String(cat.id);
      option.textContent = `${cat.icon} ${cat.name}`;
      select.appendChild(option);
    });
  });
}

function populateMemberOptions() {
  const activeMembers = state.teamMembers.filter((member) => member.status !== 'archived');
  const targetIds = ['professionalAssignedTo', 'vacationMember', 'reassignmentToMember', 'editTaskAssignedTo'];

  targetIds.forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    const allowNone = id === 'professionalAssignedTo' || id === 'editTaskAssignedTo';
    select.innerHTML = allowNone ? '<option value="">Unassigned</option>' : '<option value="">Select Member</option>';

    activeMembers.forEach((member) => {
      const option = document.createElement('option');
      option.value = String(member.id);
      option.textContent = `${member.name} (${member.status})`;
      select.appendChild(option);
    });
  });
}

function populateReassignmentTaskOptions() {
  const select = document.getElementById('reassignmentTask');
  select.innerHTML = '<option value="">Select Professional Task</option>';

  const sourceTasks = state.professionalTasksAll.length ? state.professionalTasksAll : state.professionalTasks;
  sourceTasks.forEach((task) => {
    const option = document.createElement('option');
    option.value = String(task.id);
    option.textContent = `${task.title} ${task.assigned_name ? `(${task.assigned_name})` : '(Unassigned)'}`;
    select.appendChild(option);
  });
}

function renderTeamMembers() {
  const root = document.getElementById('teamMemberList');
  root.innerHTML = '';

  if (!state.teamMembers.length) {
    root.innerHTML = '<p class="muted">No team members yet.</p>';
    return;
  }

  state.teamMembers.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'journal-item';
    row.innerHTML = `
      <strong>${member.name}</strong>
      <p class="muted">${member.email} • ${member.role}</p>
      <p class="muted">Status: ${member.status}</p>
      <div class="form-actions">
        <button class="ghost" data-action="edit">Edit</button>
        <button class="ghost" data-action="delete">Delete</button>
      </div>
    `;

    row.querySelector('[data-action="edit"]').addEventListener('click', () => {
      state.editingTeamMemberId = member.id;
      document.getElementById('teamName').value = member.name;
      document.getElementById('teamEmail').value = member.email;
      document.getElementById('teamRole').value = member.role;
      document.getElementById('teamStatus').value = member.status === 'archived' ? 'active' : member.status;
      switchView('professional');
      switchProfessionalTab('team');
    });

    row.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!window.confirm('Delete this team member?')) return;
      await api(`/api/team-members/${member.id}`, { method: 'DELETE' });
      showToast('Team member deleted');
      await loadTeamMembers();
      await loadTaskData();
    });

    root.appendChild(row);
  });
}

function renderVacations() {
  // Vacation list UI has been replaced with calendar view.
  // Keep this function as a lightweight no-op to avoid null element errors.
}

function renderReassignments() {
  const root = document.getElementById('reassignmentList');
  root.innerHTML = '';

  if (!state.reassignments.length) {
    root.innerHTML = '<p class="muted">No reassignment history yet.</p>';
    return;
  }

  state.reassignments.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'journal-item';
    row.innerHTML = `
      <strong>${entry.task_title}</strong>
      <p class="muted">From: ${entry.from_member_name || 'Unassigned'} → To: ${entry.to_member_name || 'Unknown'}</p>
      <p>${entry.reason || 'No reason provided.'}</p>
      <p class="muted">${new Date(entry.created_at).toLocaleString()}</p>
    `;
    root.appendChild(row);
  });
}

async function loadTaskData() {
  let personalData = null;
  let professionalData = null;

  try {
    personalData = await loadTasks('personal');
  } catch (error) {
    state.personalTasks = [];
    document.getElementById('personalSummaryCards').innerHTML = '';
    document.getElementById('personalTimeline').innerHTML = '<p class="muted">Unable to load personal tasks right now.</p>';
    showToast(error.message || 'Failed to load personal tasks');
  }

  try {
    const personalAllData = await loadTasks('personal', { ignoreSeverity: true, ignoreSearch: true });
    state.personalTasksAll = personalAllData.tasks;
  } catch (_error) {
    state.personalTasksAll = state.personalTasks;
  }

  try {
    professionalData = await loadTasks('professional');
  } catch (error) {
    state.professionalTasks = [];
    document.getElementById('professionalWidgetCards').innerHTML = '';
    document.getElementById('professionalTimeline').innerHTML = '<p class="muted">Unable to load professional tasks right now.</p>';
    showToast(error.message || 'Failed to load professional tasks');
  }

  if (personalData) {
    state.personalTasks = personalData.tasks;
    renderSummaryCards(personalData.summary, 'personalSummaryCards');
    renderTimeline(personalData.tasks, 'personalTimeline', 'personal');
  }

  if (professionalData) {
    state.professionalTasks = professionalData.tasks;
    renderProfessionalWidgets(professionalData.widgets || {});
    renderTimeline(professionalData.tasks, 'professionalTimeline', 'professional');
  }

  try {
    const professionalAllData = await loadTasks('professional', { ignoreSeverity: true, ignoreSearch: true });
    state.professionalTasksAll = professionalAllData.tasks;
  } catch (_error) {
    state.professionalTasksAll = state.professionalTasks;
  }

  renderDashboardTaskBlocks();
  populateReassignmentTaskOptions();
}

async function loadTeamMembers() {
  const data = await api('/api/team-members');
  state.teamMembers = data.members;
  renderTeamMembers();
  populateMemberOptions();
}

async function loadVacations() {
  const data = await api('/api/vacations');
  state.vacations = data.vacations;
  renderVacations();
}

async function loadReassignments() {
  const data = await api('/api/reassignments');
  state.reassignments = data.reassignments;
  renderReassignments();
}

// ── TEAM TASKS (flash cards) ───────────────────────────────────────────────
const MEMBER_COLORS = [
  '#5b8dee','#8b5cf6','#ec4899','#14b8a6','#f59e0b',
  '#6366f1','#10b981','#f97316','#06b6d4','#a855f7'
];

function memberColor(idx) {
  return MEMBER_COLORS[idx % MEMBER_COLORS.length];
}

let teamTaskPriority = '';

async function loadTeamTasks() {
  const data = await api('/api/team-tasks');
  state.teamMembersData = data.members; // cache for re-filter
  renderTeamTaskCards(data.members, teamTaskPriority);
}

function renderTeamTaskCards(members, priority) {
  const grid = document.getElementById('teamTasksGrid');
  const note = document.getElementById('teamTaskFilterNote');
  if (!grid) return;
  grid.innerHTML = '';

  const filtered = priority
    ? members.filter(m => m.tasks.some(t => t.severity === priority))
    : members;

  if (note) {
    note.textContent = priority
      ? `Showing ${filtered.length} member${filtered.length !== 1 ? 's' : ''} with ${priority} priority tasks`
      : `Showing all ${members.length} team members`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="muted">No team members have tasks with this priority.</p>';
    return;
  }

  filtered.forEach((member, idx) => {
    const origIdx = members.indexOf(member);
    const color = memberColor(origIdx);
    const card = document.createElement('div');
    card.className = 'team-flash-card glass';
    card.style.borderColor = color + '66';

    const allTasks = priority ? member.tasks.filter(t => t.severity === priority) : member.tasks;
    const activeTasks = allTasks.filter(t => t.status !== 'completed');
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const totalMandays = allTasks.reduce((sum, t) => sum + (t.mandays || 0), 0);

    card.innerHTML = `
      <div class="team-flash-top" style="border-left:4px solid ${color};">
        <div>
          <strong>${member.name}</strong>
          <p class="muted" style="margin:2px 0;">${member.role}</p>
        </div>
        <span class="badge" style="background:${color}22;border-color:${color}66;color:${color};">${member.status}</span>
      </div>
      <div class="team-flash-stats">
        <span>📋 ${allTasks.length} task${allTasks.length !== 1 ? 's' : ''}${priority ? ' (' + priority + ')' : ''}</span>
        <span>✅ ${completedTasks.length} done</span>
        <span>⏳ ${activeTasks.length} active</span>
        <span>📅 ${totalMandays.toFixed(1)} mandays</span>
      </div>
      <div class="team-flash-tasks">
        ${activeTasks.slice(0, 3).map(t => `
          <div class="team-flash-task-row">
            <span class="sev-dot sev-${t.severity}"></span>
            <span class="team-flash-task-title">${t.title}</span>
            <span class="muted" style="font-size:0.72rem;">${t.start_date || ''}</span>
          </div>`).join('')}
        ${activeTasks.length > 3 ? `<p class="muted" style="font-size:0.78rem;margin:4px 0;">+${activeTasks.length - 3} more…</p>` : ''}
      </div>
      <button class="ghost" style="width:100%;margin-top:8px;">View Calendar →</button>
    `;
    card.querySelector('button').addEventListener('click', () => openMemberDetail(member, origIdx));
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) openMemberDetail(member, origIdx); });
    grid.appendChild(card);
  });
}

function openMemberDetail(member, idx) {
  const color = memberColor(idx);
  document.getElementById('memberDetailName').textContent = member.name;
  document.getElementById('memberDetailRole').textContent = `${member.role} • ${member.email}`;

  // Stats
  const statsRoot = document.getElementById('memberDetailStats');
  const active = member.tasks.filter(t => t.status !== 'completed').length;
  const completed = member.tasks.filter(t => t.status === 'completed').length;
  statsRoot.innerHTML = [
    ['Total Tasks', member.tasks.length],
    ['Active', active],
    ['Completed', completed],
    ['Total Mandays', member.totalMandays.toFixed(1)]
  ].map(([label, val]) => `<article class="summary-card"><p>${label}</p><h4>${val}</h4></article>`).join('');

  // Mini calendar of tasks for current month
  const calRoot = document.getElementById('memberDetailCalendar');
  calRoot.innerHTML = '';
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const calTitle = document.createElement('h4');
  calTitle.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  calRoot.appendChild(calTitle);
  const calGrid = document.createElement('div');
  calGrid.className = 'member-cal-grid';
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayHeaders = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  dayHeaders.forEach(d => { const h = document.createElement('div'); h.className = 'cal-header'; h.textContent = d; calGrid.appendChild(h); });
  for (let i = 0; i < firstDay; i++) { const blank = document.createElement('div'); calGrid.appendChild(blank); }
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = member.tasks.filter(t => {
      if (!t.start_date) return false;
      const s = t.start_date <= dateStr;
      const e = !t.end_date || t.end_date >= dateStr;
      return s && e;
    });
    const isToday = day === now.getDate();
    cell.style.cssText = `text-align:center;padding:4px 2px;border-radius:6px;font-size:0.8rem;${isToday ? 'font-weight:700;border:2px solid ' + color + ';' : ''}${dayTasks.length ? 'background:' + color + '33;' : ''}`;
    cell.textContent = String(day);
    if (dayTasks.length) {
      cell.title = dayTasks.map(t => t.title).join(', ');
      cell.style.cursor = 'pointer';
    }
    calGrid.appendChild(cell);
  }
  calRoot.appendChild(calGrid);

  // Mandays by project
  const mdRoot = document.getElementById('memberDetailMandays');
  mdRoot.innerHTML = '';
  const byProject = new Map();
  member.tasks.forEach(t => {
    const proj = t.project_name || 'Unassigned';
    if (!byProject.has(proj)) byProject.set(proj, { mandays: 0, tasks: [], status: t.status });
    const entry = byProject.get(proj);
    entry.mandays += t.mandays || 0;
    entry.tasks.push(t);
  });
  if (!byProject.size) {
    mdRoot.innerHTML = '<p class="muted">No project data.</p>';
  } else {
    byProject.forEach((data, projName) => {
      const row = document.createElement('div');
      row.className = 'journal-item';
      const start = data.tasks.map(t => t.start_date).filter(Boolean).sort()[0] || '—';
      const end = data.tasks.map(t => t.end_date).filter(Boolean).sort().reverse()[0] || '—';
      row.innerHTML = `
        <strong>Project: ${projName}</strong>
        <p class="muted">Start: ${start} &nbsp; End: ${end} &nbsp; Status: ${data.tasks[0]?.status || '—'} &nbsp; Spent Mandays: ${data.mandays.toFixed(1)}</p>
      `;
      mdRoot.appendChild(row);
    });
  }

  document.getElementById('memberDetailModal').classList.add('open');
}

// ── VACATION CALENDAR ─────────────────────────────────────────────────────
let vacCalYear = new Date().getFullYear();
let vacCalMonth = new Date().getMonth();

async function renderVacationCalendar() {
  const data = await api('/api/vacation-calendar');
  const label = document.getElementById('vacCalMonthLabel');
  const grid = document.getElementById('vacationCalendarGrid');
  const legend = document.getElementById('vacationLegend');
  if (!grid || !label) return;

  const now = new Date(vacCalYear, vacCalMonth, 1);
  label.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = now.getDay();
  const daysInMonth = new Date(vacCalYear, vacCalMonth + 1, 0).getDate();
  grid.innerHTML = '';
  legend.innerHTML = '';

  const dayHeaders = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dayHeaders.forEach(d => {
    const h = document.createElement('div');
    h.className = 'vac-cal-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  // Build member color map from response
  const memberColors = new Map();
  data.vacations.forEach(v => { if (!memberColors.has(v.member_id)) memberColors.set(v.member_id, v.color); });

  for (let i = 0; i < firstDay; i++) { const blank = document.createElement('div'); blank.className = 'vac-cal-cell empty'; grid.appendChild(blank); }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${vacCalYear}-${String(vacCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const todayStr = new Date().toISOString().slice(0, 10);
    const cell = document.createElement('div');
    cell.className = 'vac-cal-cell' + (dateStr === todayStr ? ' vac-today' : '');

    const dayNum = document.createElement('span');
    dayNum.className = 'vac-day-num';
    dayNum.textContent = String(day);
    cell.appendChild(dayNum);

    const vacHere = data.vacations.filter(v => v.start_date <= dateStr && v.end_date >= dateStr);
    vacHere.forEach(v => {
      const chip = document.createElement('div');
      chip.className = 'vac-chip';
      chip.style.cssText = `background:${v.color}2e;border-left:3px solid ${v.color};color:${v.color};`;
      chip.textContent = v.member_name;
      chip.title = `${v.member_name}: ${v.start_date} → ${v.end_date}${v.reason ? '\n' + v.reason : ''}`;
      cell.appendChild(chip);
    });
    grid.appendChild(cell);
  }

  // Legend
  const seen = new Set();
  data.vacations.forEach(v => {
    if (seen.has(v.member_id)) return;
    seen.add(v.member_id);
    const dot = document.createElement('div');
    dot.className = 'vac-legend-item';
    dot.innerHTML = `<span class="vac-legend-dot" style="background:${v.color};"></span>${v.member_name}`;
    legend.appendChild(dot);
  });
}



function resetTeamForm() {
  state.editingTeamMemberId = null;
  document.getElementById('teamName').value = '';
  document.getElementById('teamEmail').value = '';
  document.getElementById('teamRole').value = '';
  document.getElementById('teamStatus').value = 'active';
}

function resetVacationForm() {
  state.editingVacationId = null;
  document.getElementById('vacationMember').value = '';
  document.getElementById('vacationStartDate').value = '';
  document.getElementById('vacationEndDate').value = '';
  document.getElementById('vacationReason').value = '';
}

function formatClock(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderFocusClock() {
  document.getElementById('focusClock').textContent = formatClock(state.focus.remainingSeconds);
}

function focusNotification() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Focus session complete', {
      body: 'Great work. Your timer has completed.'
    });
  }
}

function focusSound() {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.type = 'sine';
  oscillator.frequency.value = 880;
  gain.gain.value = 0.09;
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.4);
}

async function completeFocusSession() {
  const durationMinutes = state.focus.durationMinutes;
  if (state.focus.startedAt) {
    await api('/api/focus-sessions', {
      method: 'POST',
      body: JSON.stringify({
        duration_minutes: durationMinutes,
        started_at: state.focus.startedAt.toISOString(),
        completed_at: new Date().toISOString()
      })
    });
  }

  focusNotification();
  focusSound();
  showToast('Focus session complete');
  state.focus.running = false;
  state.focus.paused = false;
  state.focus.startedAt = null;
  clearInterval(state.focus.timerHandle);
  state.focus.timerHandle = null;
  await loadFocusSessions();
}

function startFocusTimer() {
  if (state.focus.running) return;
  state.focus.running = true;
  state.focus.paused = false;
  state.focus.startedAt = new Date();
  state.focus.remainingSeconds = state.focus.durationMinutes * 60;
  renderFocusClock();

  clearInterval(state.focus.timerHandle);
  state.focus.timerHandle = setInterval(async () => {
    if (!state.focus.running || state.focus.paused) return;
    state.focus.remainingSeconds -= 1;
    if (state.focus.remainingSeconds <= 0) {
      state.focus.remainingSeconds = 0;
      renderFocusClock();
      await completeFocusSession();
      return;
    }
    renderFocusClock();
  }, 1000);
}

function pauseFocusTimer() {
  if (!state.focus.running) return;
  state.focus.paused = true;
}

function resumeFocusTimer() {
  if (!state.focus.running) return;
  state.focus.paused = false;
}

function resetFocusTimer() {
  state.focus.running = false;
  state.focus.paused = false;
  state.focus.startedAt = null;
  clearInterval(state.focus.timerHandle);
  state.focus.timerHandle = null;
  state.focus.remainingSeconds = state.focus.durationMinutes * 60;
  renderFocusClock();
}

async function loadFocusSessions() {
  const data = await api('/api/focus-sessions');
  document.getElementById('focusTotalSessions').textContent = String(data.stats.totalSessions);
  document.getElementById('focusTotalMinutes').textContent = `${data.stats.totalFocusTime} min`;
  document.getElementById('focusDailySessions').textContent = String(data.stats.dailySessions);
  document.getElementById('focusWeeklySessions').textContent = String(data.stats.weeklySessions);

  const list = document.getElementById('focusSessionList');
  list.innerHTML = '';

  if (!data.sessions.length) {
    list.innerHTML = '<p class="muted">No focus sessions recorded yet.</p>';
    return;
  }

  data.sessions.forEach((session) => {
    const row = document.createElement('div');
    row.className = 'journal-item';
    row.innerHTML = `
      <strong>${session.duration_minutes} min</strong>
      <p class="muted">Started: ${new Date(session.started_at).toLocaleString()}</p>
      <p class="muted">Completed: ${new Date(session.completed_at).toLocaleString()}</p>
    `;
    list.appendChild(row);
  });
}

async function renderCharts() {
  const data = await api('/api/progress/charts');
  const css = getComputedStyle(document.documentElement);
  const accentInfo = css.getPropertyValue('--accent-info').trim() || '#539df5';
  const accentPrimary = css.getPropertyValue('--accent-primary').trim() || '#1ed760';
  const textMuted = css.getPropertyValue('--text-muted').trim() || '#b3b3b3';

  if (state.charts.trend) state.charts.trend.destroy();
  if (state.charts.category) state.charts.category.destroy();

  state.charts.trend = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: data.activityTrend.labels,
      datasets: [{
        label: 'Completed Activities',
        data: data.activityTrend.values,
        borderColor: accentInfo,
        backgroundColor: `${accentInfo}33`,
        fill: true,
        tension: 0.32
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: textMuted } } }, scales: { x: { ticks: { color: textMuted } }, y: { ticks: { color: textMuted } } } }
  });

  state.charts.category = new Chart(document.getElementById('categoryChart'), {
    type: 'bar',
    data: {
      labels: data.categoryProgress.map((x) => x.name),
      datasets: [{
        label: 'Completion %',
        data: data.categoryProgress.map((x) => x.value),
        backgroundColor: `${accentPrimary}66`,
        borderColor: accentPrimary,
        borderWidth: 1
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: textMuted } } }, scales: { x: { ticks: { color: textMuted } }, y: { ticks: { color: textMuted }, max: 100 } } }
  });
}

async function loadCompletedTasks() {
  const data = await api('/api/completed-tasks');
  const box = document.getElementById('completedTaskList');
  const stats = document.getElementById('completedStatsCards');
  box.innerHTML = '';
  stats.innerHTML = '';

  const statCards = [
    ['Completed Personal', data.stats.personal],
    ['Completed Professional', data.stats.professional],
    ['Completed Life Category', data.stats.lifeCategory],
    ['Total Completed', data.stats.total]
  ];

  statCards.forEach(([label, value]) => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    card.innerHTML = `<p>${label}</p><h4>${value}</h4>`;
    stats.appendChild(card);
  });

  data.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'achievement-item completed-entry';
    row.innerHTML = `
      <div class="completed-entry-head">
        <span class="complete-chip done">✓</span>
        <strong>${item.module} • ${item.title}</strong>
      </div>
      <p class="muted">Completed: ${new Date(item.completed_at).toLocaleString()}</p>
      <p>${item.meta}</p>
    `;
    box.appendChild(row);
  });

  if (data.items.length === 0) {
    box.innerHTML = '<p class="muted">No completed tasks yet.</p>';
  }
}

async function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme }) });
  showToast(`Theme changed to ${theme}`);
}

async function loadSettings() {
  const dbSettings = await api('/api/settings');
  const local = localStorage.getItem('theme');
  const theme = local || dbSettings.theme || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
}

async function loadDashboard() {
  const dashboard = await api('/api/dashboard');
  state.dashboard = dashboard;
  renderCategoryCards(dashboard.categories, categoryGrid);
  updateHeaderStats(dashboard.totals);
  populateCategoryOptions();
}

function bindEvents() {
  const reloadTasksSafe = async () => {
    try {
      await loadTaskData();
    } catch (error) {
      showToast(error.message || 'Failed to refresh tasks');
    }
  };

  menu.addEventListener('click', async (event) => {
    const btn = event.target.closest('.menu-btn');
    if (!btn) return;
    const view = btn.dataset.view;
    switchView(view);

    if (view === 'completedTasks') await loadCompletedTasks();
    if (view === 'lifeCategory') {
      await loadDashboard();
    }
    if (view === 'planner369') {
      await loadDashboard();
      await loadPlanner();
    }
    if (view === 'professional') {
      await loadTeamMembers();
      await loadVacations();
      await loadReassignments();
      await reloadTasksSafe();
    }
    if (view === 'teamTasks') await loadTeamTasks();
    if (view === 'focus') await loadFocusSessions();
    if (view === 'dashboard' || view === 'personalTasks' || view === 'professionalTasks') {
      await reloadTasksSafe();
      await renderCharts();
    }
  });

  closeDrawer.addEventListener('click', () => drawer.classList.remove('open'));
  drawer.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.classList.remove('open');
  });

  document.getElementById('planner369Date').value = state.plannerDate;
  document.getElementById('planner369Date').addEventListener('change', async (e) => {
    state.plannerDate = e.target.value;
    await loadPlanner();
    await loadPlannerHistory();
  });

  if (plannerHistorySelect) {
    plannerHistorySelect.addEventListener('change', async (e) => {
      const selected = e.target.value;
      if (!selected) return;
      state.plannerDate = selected;
      await loadPlanner();
      await loadPlannerHistory();
    });
  }

  document.getElementById('savePlanner369Btn').addEventListener('click', savePlanner);
  document.getElementById('deletePlanner369Btn').addEventListener('click', () => {
    deletePlanner().catch((error) => showToast(error.message || 'Failed to delete planner'));
  });
  [...plannerInputs.morning, ...plannerInputs.afternoon, ...plannerInputs.night].forEach((input) => {
    input.addEventListener('input', () => {
      renderPlannerFlashCards({
        morning: plannerInputs.morning.map((x) => x.value.trim()),
        afternoon: plannerInputs.afternoon.map((x) => x.value.trim()),
        night: plannerInputs.night.map((x) => x.value.trim())
      });
    });
  });
  document.getElementById('dashboardTaskSearch').addEventListener('input', () => {
    clearTimeout(window.__taskSearchTimer);
    window.__taskSearchTimer = setTimeout(() => {
      loadTaskData().catch((error) => showToast(error.message || 'Failed to search tasks'));
    }, 250);
  });
  document.getElementById('clearDashboardTaskSearch').addEventListener('click', () => {
    const input = document.getElementById('dashboardTaskSearch');
    input.value = '';
    loadTaskData().catch((error) => showToast(error.message || 'Failed to refresh tasks'));
  });

  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  document.querySelectorAll('.priority-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!btn.dataset.taskType) return;
      const taskType = btn.dataset.taskType;
      const severity = btn.dataset.priority || '';
      setTaskSeverityFilter(taskType, severity);
      await reloadTasksSafe();
    });
  });

  document.querySelectorAll('[data-professional-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      switchProfessionalTab(btn.dataset.professionalTab);
      if (btn.dataset.professionalTab === 'vacation') await renderVacationCalendar();
    });
  });

  document.getElementById('personalTaskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = taskFormPayload('personal', 'personal');
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Personal task created');
      resetTaskForm('personal', 'personal');
      await reloadTasksSafe();
    } catch (error) {
      showToast(error.message || 'Failed to save personal task');
    }
  });

  document.getElementById('professionalTaskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = taskFormPayload('professional', 'professional');
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Professional task created');
      resetTaskForm('professional', 'professional');
      await reloadTasksSafe();
    } catch (error) {
      showToast(error.message || 'Failed to save professional task');
    }
  });

  document.getElementById('clearPersonalTaskBtn').addEventListener('click', () => resetTaskForm('personal', 'personal'));
  document.getElementById('clearProfessionalTaskBtn').addEventListener('click', () => resetTaskForm('professional', 'professional'));

  taskEditorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      if (!state.editingTaskId || !state.editingTaskType) return;
      const taskType = state.editingTaskType;
      const payload = {
        task_type: taskType,
        title: document.getElementById('editTaskTitle').value.trim(),
        description: document.getElementById('editTaskDescription').value.trim(),
        project_name: taskType === 'professional' ? (document.getElementById('editTaskProject').value.trim() || null) : null,
        severity: document.getElementById('editTaskSeverity').value,
        status: document.getElementById('editTaskStatus').value,
        due_date: document.getElementById('editTaskDueDate').value || null,
        end_date: document.getElementById('editTaskEndDate').value || null,
        due_time: document.getElementById('editTaskDueTime').value || null,
        assigned_to: taskType === 'professional' ? (Number(document.getElementById('editTaskAssignedTo').value) || null) : null,
        category_id: taskType === 'personal' ? (Number(document.getElementById('editTaskCategory').value) || null) : null,
        mandays: parseFloat(document.getElementById('editTaskMandays').value) || null,
        notes: document.getElementById('editTaskNotes').value.trim()
      };

      await api(`/api/tasks/${state.editingTaskId}`, { method: 'PUT', body: JSON.stringify(payload) });
      closeTaskEditor();
      showToast('Task updated');
      await reloadTasksSafe();
    } catch (error) {
      showToast(error.message || 'Failed to update task');
    }
  });

  closeTaskEditorModal.addEventListener('click', closeTaskEditor);
  taskEditorModal.addEventListener('click', (event) => {
    if (event.target === taskEditorModal) closeTaskEditor();
  });

  document.getElementById('closeMemberDetailModal').addEventListener('click', () => {
    document.getElementById('memberDetailModal').classList.remove('open');
  });
  document.getElementById('memberDetailModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('memberDetailModal')) document.getElementById('memberDetailModal').classList.remove('open');
  });

  const vacPrev = document.getElementById('vacCalPrev');
  const vacNext = document.getElementById('vacCalNext');
  if (vacPrev) vacPrev.addEventListener('click', async () => { vacCalMonth--; if (vacCalMonth < 0) { vacCalMonth = 11; vacCalYear--; } await renderVacationCalendar(); });
  if (vacNext) vacNext.addEventListener('click', async () => { vacCalMonth++; if (vacCalMonth > 11) { vacCalMonth = 0; vacCalYear++; } await renderVacationCalendar(); });

  document.querySelectorAll('[data-team-priority]').forEach((btn) => {
    btn.addEventListener('click', () => {
      teamTaskPriority = btn.dataset.teamPriority || '';
      document.querySelectorAll('[data-team-priority]').forEach(b => b.classList.toggle('active', (b.dataset.teamPriority || '') === teamTaskPriority));
      if (state.teamMembersData) renderTeamTaskCards(state.teamMembersData, teamTaskPriority);
    });
  });

  document.getElementById('teamMemberForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = {
        name: document.getElementById('teamName').value.trim(),
        email: document.getElementById('teamEmail').value.trim(),
        role: document.getElementById('teamRole').value.trim(),
        status: document.getElementById('teamStatus').value
      };

      if (state.editingTeamMemberId) {
        await api(`/api/team-members/${state.editingTeamMemberId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Team member updated');
      } else {
        await api('/api/team-members', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Team member created');
      }

      resetTeamForm();
      await loadTeamMembers();
      await loadTaskData();
    } catch (error) {
      showToast(error.message || 'Failed to save team member');
    }
  });

  document.getElementById('clearTeamMemberBtn').addEventListener('click', resetTeamForm);

  document.getElementById('vacationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = {
        member_id: Number(document.getElementById('vacationMember').value),
        start_date: document.getElementById('vacationStartDate').value,
        end_date: document.getElementById('vacationEndDate').value,
        reason: document.getElementById('vacationReason').value.trim()
      };

      if (state.editingVacationId) {
        await api(`/api/vacations/${state.editingVacationId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Vacation updated');
      } else {
        await api('/api/vacations', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Vacation created');
      }

      resetVacationForm();
      await loadVacations();
      await loadTaskData();
      await loadTeamMembers();
    } catch (error) {
      showToast(error.message || 'Failed to save vacation');
    }
  });

  document.getElementById('clearVacationBtn').addEventListener('click', resetVacationForm);

  document.getElementById('reassignmentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const selectedTaskId = Number(document.getElementById('reassignmentTask').value);
      const toMember = Number(document.getElementById('reassignmentToMember').value);
      const lookup = state.professionalTasksAll.length ? state.professionalTasksAll : state.professionalTasks;
      const task = lookup.find((item) => String(item.id) === String(selectedTaskId));
      if (!task) {
        showToast('Select a valid task');
        return;
      }
      if (!toMember) {
        showToast('Select a team member for reassignment');
        return;
      }

      const payload = {
        task_id: selectedTaskId,
        from_member: task.assigned_to || null,
        to_member: toMember,
        reason: document.getElementById('reassignmentReason').value.trim()
      };

      await api('/api/reassignments', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Task reassigned');

      document.getElementById('reassignmentReason').value = '';
      await loadReassignments();
      await loadTaskData();
    } catch (error) {
      showToast(error.message || 'Failed to reassign task');
    }
  });

  document.querySelectorAll('.focus-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.focus.durationMinutes = Number(btn.dataset.minutes);
      resetFocusTimer();
    });
  });

  document.getElementById('setCustomFocusBtn').addEventListener('click', () => {
    const value = Number(document.getElementById('focusCustomMinutes').value);
    if (!value || value <= 0) {
      showToast('Enter a valid custom duration');
      return;
    }
    state.focus.durationMinutes = value;
    resetFocusTimer();
  });

  document.getElementById('focusStartBtn').addEventListener('click', startFocusTimer);
  document.getElementById('focusPauseBtn').addEventListener('click', pauseFocusTimer);
  document.getElementById('focusResumeBtn').addEventListener('click', resumeFocusTimer);
  document.getElementById('focusResetBtn').addEventListener('click', resetFocusTimer);
}

(async function init() {
  try {
    bindEvents();
    resetTaskForm('personal', 'personal');
    resetTaskForm('professional', 'professional');
    resetTeamForm();
    resetVacationForm();
    renderFocusClock();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    await loadSettings();
    await loadDashboard();
    await loadPlanner();
    await loadPlannerHistory();
    await loadTeamMembers();
    await loadVacations();
    await loadReassignments();
    await loadTaskData();
    await renderCharts();
    await loadFocusSessions();
  } catch (error) {
    showToast(error.message || 'Failed to initialize app');
  }
})();
