import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Workspace, WorkspaceMember, WorkspaceAnnouncement, WorkspaceFile, WorkspaceTask, Comment, WorkspaceActivity } from '../models/workspace.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private apiUrl = 'http://localhost:5000/workspaces';

  constructor(private http: HttpClient) { }

  private getAuthHeaders() {
    const token = localStorage.getItem('token');
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }

  private getAuthHeadersMultipart() {
    const token = localStorage.getItem('token');
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
  }

  // --- Workspace CRUD ---
  getWorkspaces(): Observable<Workspace[]> {
    return this.http.get<Workspace[]>(this.apiUrl, { headers: this.getAuthHeaders() });
  }

  getWorkspace(id: number): Observable<Workspace> {
    return this.http.get<Workspace>(`${this.apiUrl}/${id}`, { headers: this.getAuthHeaders() });
  }

  createWorkspace(data: any): Observable<Workspace> {
    return this.http.post<Workspace>(this.apiUrl, data, { headers: this.getAuthHeaders() });
  }

  updateWorkspace(id: number, data: { title: string; description: string; allow_student_uploads?: boolean }): Observable<Workspace> {
    return this.http.put<Workspace>(`${this.apiUrl}/${id}`, data, { headers: this.getAuthHeaders() });
  }

  deleteWorkspace(id: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`, { headers: this.getAuthHeaders() });
  }

  joinWorkspace(inviteCode: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/join`, { invite_code: inviteCode }, { headers: this.getAuthHeaders() });
  }

  getActivityLog(workspaceId: number): Observable<WorkspaceActivity[]> {
    return this.http.get<WorkspaceActivity[]>(`${this.apiUrl}/${workspaceId}/activity`, { headers: this.getAuthHeaders() });
  }

  deleteActivity(workspaceId: number, activityId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${workspaceId}/activity/${activityId}`, { headers: this.getAuthHeaders() });
  }

  clearAllActivities(workspaceId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${workspaceId}/activity`, { headers: this.getAuthHeaders() });
  }

  // --- Members ---
  getMembers(workspaceId: number): Observable<WorkspaceMember[]> {
    return this.http.get<WorkspaceMember[]>(`${this.apiUrl}/${workspaceId}/members`, { headers: this.getAuthHeaders() });
  }

  removeMember(workspaceId: number, userId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${workspaceId}/members/${userId}`, { headers: this.getAuthHeaders() });
  }

  // --- Announcements ---
  getAnnouncements(workspaceId: number): Observable<WorkspaceAnnouncement[]> {
    return this.http.get<WorkspaceAnnouncement[]>(`${this.apiUrl}/${workspaceId}/announcements`, { headers: this.getAuthHeaders() });
  }

  createAnnouncement(workspaceId: number, title: string, content: string): Observable<WorkspaceAnnouncement> {
    return this.http.post<WorkspaceAnnouncement>(
      `${this.apiUrl}/${workspaceId}/announcements`,
      { title, content },
      { headers: this.getAuthHeaders() }
    );
  }

  // --- Files ---
  getWorkspaceFiles(workspaceId: number): Observable<WorkspaceFile[]> {
    return this.http.get<WorkspaceFile[]>(`${this.apiUrl}/${workspaceId}/files`, { headers: this.getAuthHeaders() });
  }

  uploadPdf(workspaceId: number, file: File, description?: string): Observable<WorkspaceFile> {
    const formData = new FormData();
    // Dosya adını ayrı alan olarak İLK gönder (Multer parse ederken req.body'ye düşmesi için)
    formData.append('originalFileName', encodeURIComponent(file.name));
    if (description) formData.append('description', description);
    formData.append('file', file);
    return this.http.post<WorkspaceFile>(
      `${this.apiUrl}/${workspaceId}/upload`,
      formData,
      { headers: this.getAuthHeadersMultipart() }
    );
  }

  deleteWorkspaceFile(workspaceId: number, fileId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${workspaceId}/files/${fileId}`, { headers: this.getAuthHeaders() });
  }

  // --- Workspace Tasks ---
  getWorkspaceTasks(workspaceId: number): Observable<WorkspaceTask[]> {
    return this.http.get<WorkspaceTask[]>(`${this.apiUrl}/${workspaceId}/tasks`, { headers: this.getAuthHeaders() });
  }

  createWorkspaceTask(workspaceId: number, data: { title: string; description?: string; due_date?: string; assign_to?: number[] }): Observable<WorkspaceTask> {
    return this.http.post<WorkspaceTask>(
      `${this.apiUrl}/${workspaceId}/tasks`,
      data,
      { headers: this.getAuthHeaders() }
    );
  }

  deleteWorkspaceTask(workspaceId: number, taskId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${workspaceId}/tasks/${taskId}`, { headers: this.getAuthHeaders() });
  }

  updateTaskStatus(workspaceId: number, taskId: number, status: string): Observable<any> {
    return this.http.put<any>(
      `${this.apiUrl}/${workspaceId}/tasks/${taskId}/status`,
      { status },
      { headers: this.getAuthHeaders() }
    );
  }

  // --- Comments ---
  getComments(workspaceId: number, taskId?: number, announcementId?: number): Observable<Comment[]> {
    let url = `${this.apiUrl}/${workspaceId}/comments`;
    const params: string[] = [];
    if (taskId) params.push(`task_id=${taskId}`);
    if (announcementId) params.push(`announcement_id=${announcementId}`);
    if (params.length) url += '?' + params.join('&');
    return this.http.get<Comment[]>(url, { headers: this.getAuthHeaders() });
  }

  addComment(workspaceId: number, content: string, taskId?: number, announcementId?: number): Observable<Comment> {
    return this.http.post<Comment>(
      `${this.apiUrl}/${workspaceId}/comments`,
      { content, task_id: taskId, announcement_id: announcementId },
      { headers: this.getAuthHeaders() }
    );
  }
}
