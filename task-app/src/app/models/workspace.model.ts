export interface Workspace {
  id?: number;
  title: string;
  description: string;
  banner_color: string;
  invite_code?: string;
  created_by?: number;
  created_at?: string;
  my_role?: string;
  allow_student_uploads?: boolean;
}

export interface WorkspaceMember {
  user_id: number;
  user_name: string;
  email: string;
  role: string;
  joined_at?: string;
}

export interface WorkspaceAnnouncement {
  id?: number;
  workspace_id: number;
  title?: string;
  content: string;
  created_by?: number;
  creator_name?: string;
  created_at?: string;
}

export interface WorkspaceFile {
  id?: number;
  workspace_id: number;
  file_name: string;
  file_path: string;
  file_type?: string;
  uploaded_by?: number;
  uploader_name?: string;
  uploaded_at?: string;
  description?: string;
}

export interface WorkspaceTask {
  id?: number;
  title: string;
  description?: string;
  due_date?: string;
  status: string;
  userid?: number;
  workspace_id?: number;
  assigned_by?: number;
  creator_name?: string;
}

export interface Comment {
  id?: number;
  workspace_id: number;
  task_id?: number;
  announcement_id?: number;
  user_id: number;
  user_name?: string;
  content: string;
  created_at?: string;
}

export interface WorkspaceActivity {
  id: number;
  workspace_id: number;
  user_id: number;
  user_name: string;
  action_type: 'announcement' | 'task_assigned' | 'task_completed' | 'file_uploaded' | 'comment' | 'workspace_created' | string;
  description: string;
  created_at: string;
}
