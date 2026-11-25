import type {
  Address,
  Drawing,
  File,
  Person,
  Project,
  ProjectStatus,
  ProjectUser,
  ProjectUserRole,
  Task,
  TaskPriority,
  TaskStatus,
} from './types.js';

type Raw = Record<string, unknown>;

/** Agave-style opaque id: stable, URL-safe, and decodable for debugging. */
export function unifiedId(type: string, sourceId: string): string {
  return Buffer.from(`fieldwire/${type}/${sourceId}`).toString('base64url');
}

export function decodeUnifiedId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

function str(raw: Raw, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function num(raw: Raw, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function iso(raw: Raw, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) {
      const d = new Date(v);
      if (!Number.isNaN(d.valueOf())) return d.toISOString();
    }
    // Fieldwire sometimes serializes timestamps as epoch seconds.
    if (typeof v === 'number' && v > 0) {
      const d = new Date(v > 1e12 ? v : v * 1000);
      if (!Number.isNaN(d.valueOf())) return d.toISOString();
    }
  }
  return null;
}

function sourceId(raw: Raw): string {
  return str(raw, 'id', 'uuid', 'device_id', 'token') ?? '';
}

function base(type: string, raw: Raw, path: string) {
  const sid = sourceId(raw);
  return {
    id: unifiedId(type, sid),
    source_id: sid,
    source_create_time: iso(raw, 'created_at', 'created_on', 'createdAt', 'inserted_at'),
    source_update_time: iso(raw, 'updated_at', 'last_modified_at', 'updatedAt', 'modified_at'),
    source_data: { path, data: raw },
  };
}

function person(raw: Raw | null | undefined): Person | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const first = str(r, 'first_name', 'firstName');
  const last = str(r, 'last_name', 'lastName');
  const name = str(r, 'name', 'full_name', 'display_name') ?? [first, last].filter(Boolean).join(' ');
  const email = str(r, 'email', 'email_address');
  if (!name && !email) return null;
  return { source_id: sourceId(r) || null, name: name || null, email };
}

function address(raw: Raw): Address | null {
  const street1 = str(raw, 'address', 'address_line_1', 'street', 'street_1');
  const city = str(raw, 'city', 'locality');
  const state = str(raw, 'state', 'region', 'province');
  const postal = str(raw, 'zip', 'zipcode', 'postal_code');
  const country = str(raw, 'country', 'country_code');
  if (!street1 && !city && !state && !postal) return null;
  return {
    street_1: street1,
    street_2: str(raw, 'address_line_2', 'street_2'),
    city,
    state,
    postal_code: postal,
    country,
  };
}

/**
 * Fieldwire serializes several enums numerically. Mappings below are confirmed
 * against live payloads during `discover`; anything unrecognized falls through
 * to null rather than being guessed at, and lands in diagnostics.warnings.
 */
const TASK_STATUS_BY_NUMBER: Record<number, TaskStatus> = {
  0: 'open',
  1: 'in_progress',
  2: 'completed',
  3: 'verified',
  4: 'closed',
};

const TASK_STATUS_BY_NAME: Record<string, TaskStatus> = {
  'to do': 'open',
  todo: 'open',
  open: 'open',
  'in progress': 'in_progress',
  in_progress: 'in_progress',
  started: 'in_progress',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
  verified: 'verified',
  closed: 'closed',
};

export function taskStatus(raw: Raw): TaskStatus | null {
  const v = raw['status'] ?? raw['status_name'] ?? raw['state'];
  if (typeof v === 'number') return TASK_STATUS_BY_NUMBER[v] ?? null;
  if (typeof v === 'string') {
    const key = v.trim().toLowerCase();
    return TASK_STATUS_BY_NAME[key] ?? (Number.isFinite(Number(key)) ? TASK_STATUS_BY_NUMBER[Number(key)] ?? null : null);
  }
  if (raw['is_completed'] === true || raw['completed_at']) return 'completed';
  return null;
}

const PRIORITY_BY_NUMBER: Record<number, TaskPriority> = { 1: 'low', 2: 'medium', 3: 'high' };

export function taskPriority(raw: Raw): TaskPriority | null {
  const v = raw['priority'] ?? raw['priority_name'];
  if (typeof v === 'number') return PRIORITY_BY_NUMBER[v] ?? null;
  if (typeof v === 'string') {
    const key = v.trim().toLowerCase();
    if (key === 'low' || key === 'medium' || key === 'high') return key;
    if (Number.isFinite(Number(key))) return PRIORITY_BY_NUMBER[Number(key)] ?? null;
  }
  return null;
}

function projectStatus(raw: Raw): ProjectStatus | null {
  if (raw['archived'] === true || raw['is_archived'] === true) return 'archived';
  const v = str(raw, 'status', 'state');
  if (!v) return 'active';
  const key = v.toLowerCase();
  if (key === 'active' || key === 'inactive' || key === 'archived') return key;
  return 'active';
}

const ROLE_BY_NAME: Record<string, ProjectUserRole> = {
  admin: 'admin',
  owner: 'admin',
  member: 'member',
  user: 'member',
  follower: 'follower',
  viewer: 'viewer',
  'view only': 'viewer',
};

export function normalizeProject(raw: Raw, path: string): Project {
  return {
    ...base('project', raw, path),
    name: str(raw, 'name', 'title') ?? '(untitled project)',
    code: str(raw, 'code', 'number', 'project_code', 'job_number'),
    description: str(raw, 'description', 'notes'),
    status: projectStatus(raw),
    address: address(raw),
    start_date: iso(raw, 'start_date', 'started_at', 'begin_date'),
    completion_date: iso(raw, 'end_date', 'completion_date', 'finish_date'),
  };
}

export function normalizeTask(raw: Raw, projectId: string, path: string): Task {
  const assigneeSource =
    (Array.isArray(raw['assignees']) && raw['assignees']) ||
    (Array.isArray(raw['users']) && raw['users']) ||
    (raw['owner'] ? [raw['owner']] : []);
  const tags = Array.isArray(raw['tags'])
    ? raw['tags'].map((t) => (typeof t === 'string' ? t : str(t as Raw, 'name') ?? '')).filter(Boolean)
    : [];

  return {
    ...base('task', raw, path),
    project_id: projectId,
    number: num(raw, 'sequence_number', 'number', 'task_number'),
    name: str(raw, 'name', 'title', 'subject') ?? '(untitled task)',
    description: str(raw, 'description', 'notes', 'body'),
    status: taskStatus(raw),
    priority: taskPriority(raw),
    assignees: (assigneeSource as Raw[]).map(person).filter((p): p is Person => p !== null),
    created_by: person(raw['creator'] as Raw) ?? person(raw['created_by'] as Raw),
    due_date: iso(raw, 'due_at', 'due_date', 'end_date'),
    completed_date: iso(raw, 'completed_at', 'completed_on'),
    location: str(raw, 'location_name', 'location', 'floorplan_name'),
    category: str(raw, 'category_name', 'category', 'kind', 'type'),
    tags,
    drawing_id: (() => {
      const sid = str(raw, 'sheet_id', 'floorplan_id', 'drawing_id');
      return sid ? unifiedId('drawing', sid) : null;
    })(),
    attachment_count:
      num(raw, 'attachments_count', 'attachment_count', 'photo_count') ??
      (Array.isArray(raw['attachments']) ? raw['attachments'].length : 0),
  };
}

export function normalizeDrawing(raw: Raw, projectId: string, path: string): Drawing {
  return {
    ...base('drawing', raw, path),
    project_id: projectId,
    number: str(raw, 'number', 'sheet_number', 'code'),
    name: str(raw, 'name', 'title', 'original_filename') ?? '(untitled sheet)',
    revision: str(raw, 'revision', 'version', 'rev'),
    discipline: str(raw, 'discipline', 'trade'),
    folder: str(raw, 'folder_name', 'folder', 'plan_folder_name'),
    issue_date: iso(raw, 'issue_date', 'issued_at', 'published_at', 'created_at'),
    file_url: str(raw, 'file_url', 'url', 'original_url', 'thumb_url'),
    page_count: num(raw, 'page_count', 'pages'),
  };
}

export function normalizeProjectUser(raw: Raw, projectId: string, path: string): ProjectUser {
  const user = (raw['user'] as Raw) ?? raw;
  const roleRaw = str(raw, 'role', 'role_name', 'permission', 'access_level');
  return {
    ...base('project_user', raw, path),
    project_id: projectId,
    first_name: str(user, 'first_name', 'firstName'),
    last_name: str(user, 'last_name', 'lastName'),
    email: str(user, 'email', 'email_address'),
    phone: str(user, 'phone', 'phone_number', 'mobile'),
    company: str(raw, 'company_name', 'company', 'organization') ?? str(user, 'company_name', 'company'),
    role: roleRaw ? ROLE_BY_NAME[roleRaw.toLowerCase()] ?? null : null,
    status: (() => {
      if (raw['deleted_at'] || raw['active'] === false) return 'inactive' as const;
      if (raw['invited_at'] && !raw['accepted_at']) return 'invited' as const;
      return 'active' as const;
    })(),
  };
}

export function normalizeFile(raw: Raw, projectId: string, path: string): File {
  return {
    ...base('file', raw, path),
    project_id: projectId,
    name: str(raw, 'name', 'filename', 'original_filename', 'title') ?? '(untitled file)',
    folder: str(raw, 'folder_name', 'folder', 'parent_name'),
    mime_type: str(raw, 'content_type', 'mime_type', 'type'),
    size_bytes: num(raw, 'size', 'file_size', 'bytes'),
    url: str(raw, 'url', 'file_url', 'download_url'),
    uploaded_by: person(raw['user'] as Raw) ?? person(raw['uploaded_by'] as Raw),
  };
}
