import { Component, OnInit, OnDestroy, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../services/workspace.service';
import { NotificationService } from '../../services/notification.service';
import { Workspace, WorkspaceMember, WorkspaceAnnouncement, WorkspaceFile, WorkspaceTask, Comment, WorkspaceActivity } from '../../models/workspace.model';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';

@Component({
  selector: 'app-workspace-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, NotificationBellComponent],
  templateUrl: './workspace-detail.html',
  styleUrl: './workspace-detail.css'
})
export class WorkspaceDetailComponent implements OnInit, OnDestroy {
  workspace: Workspace | null = null;
  activeTab: 'stream' | 'tasks' | 'members' | 'files' | 'submissions' | 'activity' = 'stream';
  isDarkMode: boolean = false;
  errorMessage: string = '';

  // Data
  members: WorkspaceMember[] = [];
  announcements: (WorkspaceAnnouncement & { _comments?: Comment[]; _newComment?: string })[] = [];
  files: WorkspaceFile[] = [];
  managerFiles: WorkspaceFile[] = [];
  mySubmissions: WorkspaceFile[] = [];
  studentSubmissions: WorkspaceFile[] = [];
  tasks: (WorkspaceTask & { _comments?: Comment[]; _newComment?: string })[] = [];
  activityLog: WorkspaceActivity[] = [];

  // Forms
  newAnnouncementContent: string = '';
  newTaskTitle: string = '';
  newTaskDesc: string = '';
  newTaskDueDate: string = '';
  showTaskModal: boolean = false;
  selectedFile: File | null = null;
  newFileDescription: string = '';
  
  // Submissions
  selectedSubmissionFile: File | null = null;
  newSubmissionDescription: string = '';

  // Edit Workspace Modal
  showEditModal: boolean = false;
  editTitle: string = '';
  editDesc: string = '';
  editAllowStudentUploads: boolean = false;

  // Toast
  toastMessage: string = '';
  toastVisible: boolean = false;
  private toastTimer: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private workspaceService: WorkspaceService,
    private eRef: ElementRef
  ) {}

  get isOwner(): boolean {
    return this.workspace?.my_role === 'owner';
  }

  currentUserId: number = 0;

  ngOnInit(): void {
    this.currentUserId = Number(localStorage.getItem('userId') || '0');
    if (localStorage.getItem('theme') === 'dark') {
      this.isDarkMode = true;
      document.body.classList.add('dark-theme');
    }

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadWorkspace(Number(id));
    }
  }

  ngOnDestroy(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  loadWorkspace(id: number): void {
    this.workspaceService.getWorkspace(id).subscribe({
      next: (data) => {
        this.workspace = data;
        this.loadAllData(id);
      },
      error: () => this.errorMessage = 'Çalışma alanı yüklenemedi veya erişim izniniz yok.'
    });
  }

  loadAllData(wsId: number): void {
    this.workspaceService.getMembers(wsId).subscribe({
      next: (data) => this.members = data,
      error: () => {}
    });
    this.workspaceService.getAnnouncements(wsId).subscribe({
      next: (data) => {
        this.announcements = data.map(a => ({ ...a, _comments: [], _newComment: '' }));
        // Load comments for each announcement
        for (const ann of this.announcements) {
          if (ann.id) {
            this.workspaceService.getComments(wsId, undefined, ann.id).subscribe({
              next: (comments) => ann._comments = comments,
              error: () => {}
            });
          }
        }
      },
      error: () => {}
    });
    this.workspaceService.getWorkspaceFiles(wsId).subscribe({
      next: (data) => {
        this.files = data;
        const ownerId = this.workspace?.created_by;
        this.managerFiles = data.filter(f => f.uploaded_by === ownerId);
        this.studentSubmissions = data.filter(f => f.uploaded_by !== ownerId);
        this.mySubmissions = data.filter(f => f.uploaded_by === this.currentUserId);
      },
      error: () => {}
    });
    this.workspaceService.getWorkspaceTasks(wsId).subscribe({
      next: (data) => {
        this.tasks = data.map(t => ({ ...t, _comments: [], _newComment: '' }));
        // Load comments for each task
        for (const task of this.tasks) {
          if (task.id) {
            this.workspaceService.getComments(wsId, task.id).subscribe({
              next: (comments) => task._comments = comments,
              error: () => {}
            });
          }
        }
      },
      error: () => {}
    });
    this.loadActivityLog(wsId);
  }

  loadActivityLog(wsId: number): void {
    this.workspaceService.getActivityLog(wsId).subscribe({
      next: (data) => this.activityLog = data,
      error: () => {}
    });
  }

  deleteActivity(activity: WorkspaceActivity): void {
    if (!this.workspace?.id || !activity.id) return;
    
    // Yalnızca owner veya kendi aktivitesi ise silebilir
    if (!this.isOwner && activity.user_id !== this.currentUserId) {
      this.showToast('Bu aktiviteyi silme yetkiniz yok.');
      return;
    }

    if (confirm('Bu aktiviteyi silmek istediğinize emin misiniz?')) {
      this.workspaceService.deleteActivity(this.workspace.id, activity.id).subscribe({
        next: () => {
          this.showToast('Aktivite başarıyla silindi ✓');
          this.loadActivityLog(this.workspace!.id!);
        },
        error: () => this.showToast('Aktivite silinemedi.')
      });
    }
  }

  clearActivities(): void {
    if (!this.workspace?.id) return;
    if (!this.isOwner) {
      this.showToast('Tüm aktiviteleri sadece yönetici temizleyebilir.');
      return;
    }

    if (confirm('Tüm aktivite geçmişini temizlemek istediğinize emin misiniz? Bu işlem geri alınamaz!')) {
      this.workspaceService.clearAllActivities(this.workspace.id).subscribe({
        next: () => {
          this.showToast('Tüm aktiviteler temizlendi ✓');
          this.loadActivityLog(this.workspace!.id!);
        },
        error: () => this.showToast('Aktiviteler temizlenemedi.')
      });
    }
  }

  setTab(tab: 'stream' | 'tasks' | 'members' | 'files' | 'submissions' | 'activity'): void {
    this.activeTab = tab;
    if (tab === 'activity' && this.workspace?.id) {
      this.loadActivityLog(this.workspace.id);
    }
  }

  getInitial(): string {
    return localStorage.getItem('userName')?.charAt(0)?.toUpperCase() || 'U';
  }

  getOwners(): WorkspaceMember[] {
    return this.members.filter(m => m.role === 'owner');
  }

  getMembers(): WorkspaceMember[] {
    return this.members.filter(m => m.role === 'member');
  }

  removeMember(member: WorkspaceMember): void {
    if (!this.workspace?.id || !member.user_id) return;
    if (confirm(`${member.user_name} adlı üyeyi çalışma alanından çıkarmak istediğinize emin misiniz?`)) {
      this.workspaceService.removeMember(this.workspace.id, member.user_id).subscribe({
        next: () => this.loadAllData(this.workspace!.id!),
        error: () => this.errorMessage = 'Üye çıkarılamadı.'
      });
    }
  }

  // --- Edit Workspace ---
  openEditModal(): void {
    if (!this.workspace) return;
    this.editTitle = this.workspace.title;
    this.editDesc = this.workspace.description || '';
    this.editAllowStudentUploads = this.workspace.allow_student_uploads || false;
    this.showEditModal = true;
  }

  saveWorkspaceEdit(): void {
    if (!this.editTitle.trim() || !this.workspace?.id) return;
    this.workspaceService.updateWorkspace(this.workspace.id, {
      title: this.editTitle.trim(),
      description: this.editDesc,
      allow_student_uploads: this.editAllowStudentUploads
    }).subscribe({
      next: (updated) => {
        this.workspace!.title = updated.title;
        this.workspace!.description = updated.description;
        this.workspace!.allow_student_uploads = updated.allow_student_uploads;
        this.showEditModal = false;
        this.showToast('Çalışma alanı bilgileri başarıyla güncellendi ✓');
      },
      error: () => this.errorMessage = 'Çalışma alanı güncellenemedi.'
    });
  }

  deleteWorkspace(): void {
    if (!this.workspace?.id) return;
    if (confirm('Çalışma alanını silmek istediğinize emin misiniz? Bu işlem geri alınamaz ve tüm veriler silinir.')) {
      this.workspaceService.deleteWorkspace(this.workspace.id).subscribe({
        next: () => {
          this.showToast('Çalışma alanı başarıyla silindi.');
          setTimeout(() => this.router.navigate(['/workspaces']), 1500);
        },
        error: () => this.errorMessage = 'Çalışma alanı silinemedi.'
      });
    }
  }

  // --- Toast ---
  showToast(msg: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage = msg;
    this.toastVisible = true;
    this.toastTimer = setTimeout(() => {
      this.toastVisible = false;
    }, 3000);
  }

  // --- Announcements ---
  createAnnouncement(): void {
    if (!this.newAnnouncementContent.trim() || !this.workspace?.id) return;
    this.workspaceService.createAnnouncement(this.workspace.id, '', this.newAnnouncementContent).subscribe({
      next: () => {
        this.newAnnouncementContent = '';
        this.loadAllData(this.workspace!.id!);
      },
      error: () => this.errorMessage = 'Duyuru oluşturulamadı.'
    });
  }

  addCommentToAnnouncement(ann: WorkspaceAnnouncement & { _newComment?: string; _comments?: Comment[] }): void {
    if (!ann._newComment?.trim() || !this.workspace?.id || !ann.id) return;
    this.workspaceService.addComment(this.workspace.id, ann._newComment, undefined, ann.id).subscribe({
      next: (comment) => {
        if (!ann._comments) ann._comments = [];
        ann._comments.push(comment);
        ann._newComment = '';
        // Reload comments to get user_name
        this.workspaceService.getComments(this.workspace!.id!, undefined, ann.id).subscribe({
          next: (comments) => ann._comments = comments,
          error: () => {}
        });
      },
      error: () => {}
    });
  }

  // --- Tasks ---
  createTask(): void {
    if (!this.newTaskTitle.trim() || !this.workspace?.id) return;
    this.workspaceService.createWorkspaceTask(this.workspace.id, {
      title: this.newTaskTitle,
      description: this.newTaskDesc,
      due_date: this.newTaskDueDate || undefined
    }).subscribe({
      next: () => {
        this.showTaskModal = false;
        this.newTaskTitle = '';
        this.newTaskDesc = '';
        this.newTaskDueDate = '';
        this.loadAllData(this.workspace!.id!);
      },
      error: () => this.errorMessage = 'Görev oluşturulamadı.'
    });
  }

  addCommentToTask(task: WorkspaceTask & { _newComment?: string; _comments?: Comment[] }): void {
    if (!task._newComment?.trim() || !this.workspace?.id || !task.id) return;
    this.workspaceService.addComment(this.workspace.id, task._newComment, task.id).subscribe({
      next: (comment) => {
        if (!task._comments) task._comments = [];
        task._comments.push(comment);
        task._newComment = '';
        // Reload comments to get user_name
        this.workspaceService.getComments(this.workspace!.id!, task.id).subscribe({
          next: (comments) => task._comments = comments,
          error: () => {}
        });
      },
      error: () => {}
    });
  }

  deleteTask(task: WorkspaceTask): void {
    if (!this.workspace?.id || !task.id) return;
    if (confirm('Bu çalışma alanı görevini silmek istediğinize emin misiniz?')) {
      this.workspaceService.deleteWorkspaceTask(this.workspace.id, task.id).subscribe({
        next: () => this.loadAllData(this.workspace!.id!),
        error: () => this.errorMessage = 'Görev silinemedi.'
      });
    }
  }

  toggleTaskCompletion(task: WorkspaceTask): void {
    if (!this.workspace?.id || !task.id) return;
    const newStatus = task.status === 'Tamamlandı' ? 'Bekliyor' : 'Tamamlandı';
    this.workspaceService.updateTaskStatus(this.workspace.id, task.id, newStatus).subscribe({
      next: () => this.loadAllData(this.workspace!.id!),
      error: () => this.errorMessage = 'Görev güncellenemedi.'
    });
  }

  // --- Files ---
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
      const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (allowedExtensions.includes(fileExt)) {
        this.selectedFile = file;
        this.errorMessage = '';
      } else {
        this.errorMessage = 'Sadece PDF, Word ve PowerPoint dosyaları yüklenebilir.';
        this.selectedFile = null;
      }
    }
  }

  onSubmissionFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      const allowedExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx'];
      const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (allowedExtensions.includes(fileExt)) {
        this.selectedSubmissionFile = file;
        this.errorMessage = '';
      } else {
        this.errorMessage = 'Sadece PDF, Word ve PowerPoint dosyaları yüklenebilir.';
        this.selectedSubmissionFile = null;
      }
    }
  }

  uploadFile(): void {
    if (!this.selectedFile || !this.workspace?.id) return;
    this.workspaceService.uploadPdf(this.workspace.id, this.selectedFile, this.newFileDescription).subscribe({
      next: () => {
        this.selectedFile = null;
        this.newFileDescription = '';
        this.loadAllData(this.workspace!.id!);
        this.showToast('Dosya başarıyla yüklendi ✓');
      },
      error: () => this.errorMessage = 'Dosya yüklenemedi.'
    });
  }

  uploadSubmission(): void {
    if (!this.selectedSubmissionFile || !this.workspace?.id) return;
    this.workspaceService.uploadPdf(this.workspace.id, this.selectedSubmissionFile, this.newSubmissionDescription).subscribe({
      next: () => {
        this.selectedSubmissionFile = null;
        this.newSubmissionDescription = '';
        this.loadAllData(this.workspace!.id!);
        this.showToast('Dosya başarıyla teslim edildi ✓');
      },
      error: () => this.errorMessage = 'Dosya yüklenemedi. (Çalışma alanı ayarlarından üye yükleme izninin açık olduğundan emin olun)'
    });
  }

  deleteFile(file: WorkspaceFile): void {
    if (!this.workspace?.id || !file.id) return;
    if (confirm('Bu dosyayı silmek istediğinize emin misiniz?')) {
      this.workspaceService.deleteWorkspaceFile(this.workspace.id, file.id).subscribe({
        next: () => {
          this.loadAllData(this.workspace!.id!);
          this.showToast('Dosya başarıyla silindi ✓');
        },
        error: () => this.errorMessage = 'Dosya silinemedi.'
      });
    }
  }

  copyInvite(code: string | undefined): void {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.showToast('Davet kodu başarıyla kopyalandı ✓');
    });
  }

  getActivityIcon(type: string): string {
    const icons: Record<string, string> = {
      announcement: '📢',
      task_assigned: '📋',
      task_completed: '✅',
      file_uploaded: '📄',
      comment: '💬'
    };
    return icons[type] || '🔔';
  }

  goBack(): void {
    this.router.navigate(['/workspaces']);
  }
}
