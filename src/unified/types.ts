/**
 * Agave-style unified models.
 *
 * Shape follows Agave's conventions so a consumer already written against
 * Agave's Procore/Autodesk connectors needs no new code path for Fieldwire:
 *  - opaque `id`, plus the native `source_id`
 *  - `source_create_time` / `source_update_time` passthrough
 *  - `source_data: { path, data }` carrying the untouched upstream record
 */

export interface SourceData {
  /** The upstream path this record came from. */
  path: string;
  /** Verbatim upstream payload, so nothing is lost in normalization. */
  data: unknown;
}

export interface UnifiedRecord {
  id: string;
  source_id: string;
  source_create_time: string | null;
  source_update_time: string | null;
  source_data: SourceData;
}

export interface Address {
  street_1: string | null;
  street_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

export type ProjectStatus = 'active' | 'inactive' | 'archived';

export interface Project extends UnifiedRecord {
  name: string;
  code: string | null;
  description: string | null;
  status: ProjectStatus | null;
  address: Address | null;
  start_date: string | null;
  completion_date: string | null;
}

export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'verified' | 'closed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Person {
  source_id: string | null;
  name: string | null;
  email: string | null;
}

export interface Task extends UnifiedRecord {
  project_id: string;
  number: number | null;
  name: string;
  description: string | null;
  status: TaskStatus | null;
  priority: TaskPriority | null;
  assignees: Person[];
  created_by: Person | null;
  due_date: string | null;
  completed_date: string | null;
  location: string | null;
  category: string | null;
  tags: string[];
  drawing_id: string | null;
  attachment_count: number;
}

export interface Drawing extends UnifiedRecord {
  project_id: string;
  number: string | null;
  name: string;
  revision: string | null;
  discipline: string | null;
  folder: string | null;
  issue_date: string | null;
  file_url: string | null;
  page_count: number | null;
}

export type ProjectUserRole = 'admin' | 'member' | 'follower' | 'viewer';

export interface ProjectUser extends UnifiedRecord {
  project_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: ProjectUserRole | null;
  status: 'active' | 'invited' | 'inactive' | null;
}

export interface File extends UnifiedRecord {
  project_id: string;
  name: string;
  folder: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  uploaded_by: Person | null;
}

/** Agave paginates with an opaque `next_page` cursor. */
export interface UnifiedResponse<T> {
  data: T[];
  next_page: string | null;
}

export interface SyncResult {
  source: 'fieldwire';
  /** 'live' = driven against app.fieldwire.com; 'fixtures' = recorded payloads. */
  mode: 'live' | 'fixtures';
  synced_at: string;
  projects: Project[];
  tasks: Task[];
  drawings: Drawing[];
  project_users: ProjectUser[];
  files: File[];
  diagnostics: {
    captured_calls: number;
    api_base_url: string | null;
    endpoints: Array<{ method: string; endpoint: string; hits: number; sampleKeys: string[] }>;
    warnings: string[];
    duration_ms: number;
  };
}

export type ResourceName = 'projects' | 'tasks' | 'drawings' | 'project_users' | 'files';
