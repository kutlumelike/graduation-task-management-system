import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TaskFile } from '../models/file.model';

@Injectable({
  providedIn: 'root'
})
export class FileService {
  private apiUrl = 'http://localhost:5000';

  constructor(private http: HttpClient) {}

  private getHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
  }

  uploadFile(taskId: number, file: File): Observable<TaskFile> {
    const formData = new FormData();
    formData.append('originalFileName', encodeURIComponent(file.name));
    formData.append('file', file);
    
    // Note: HttpHeaders shouldn't set Content-Type for FormData, browser does it automatically with boundary
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    });
    
    return this.http.post<TaskFile>(`${this.apiUrl}/tasks/${taskId}/upload`, formData, { headers });
  }

  getTaskFiles(taskId: number): Observable<TaskFile[]> {
    return this.http.get<TaskFile[]>(`${this.apiUrl}/tasks/${taskId}/files`, { headers: this.getHeaders() });
  }

  deleteFile(fileId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/files/${fileId}`, { headers: this.getHeaders() });
  }
}
