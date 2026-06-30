import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { WorkspaceService } from '../../services/workspace.service';
import { AuthService } from '../../services/auth.service';
import { Workspace, WorkspaceMember } from '../../models/workspace.model';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { PageHeaderComponent } from '../../components/page-header/page-header.component';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';

@Component({
  selector: 'app-workspace-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, NotificationBellComponent, NavbarComponent, PageHeaderComponent, EmptyStateComponent],
  templateUrl: './workspace-list.html',
  styleUrl: './workspace-list.css'
})
export class WorkspaceListComponent implements OnInit, OnDestroy {
  workspaces: Workspace[] = [];
  userRole: string = 'user';

  
  showCreateModal: boolean = false;
  showJoinModal: boolean = false;
  
  newWsTitle: string = '';
  newWsDesc: string = '';
  joinInviteCode: string = '';
  errorMessage: string = '';

  // Toast
  toastMessage: string = '';
  toastVisible: boolean = false;
  private toastTimer: any;

  constructor(
    private workspaceService: WorkspaceService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.userRole = this.authService.getRole();
    this.loadWorkspaces();
  }

  ngOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  loadWorkspaces(): void {
    this.errorMessage = '';
    this.workspaceService.getWorkspaces().subscribe({
      next: (data) => {
        this.workspaces = data;
        this.errorMessage = '';
      },
      error: (err) => {
        console.error('Workspaces load error:', err);
        if (err.status === 401 || err.status === 403) {
          this.errorMessage = 'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.';
        } else {
          this.errorMessage = 'Çalışma alanları yüklenemedi. Sunucu bağlantısını kontrol edin.';
        }
      }
    });
  }

  createWorkspace(): void {
    if (!this.newWsTitle.trim()) return;
    this.workspaceService.createWorkspace({
      title: this.newWsTitle,
      description: this.newWsDesc
    }).subscribe({
      next: (ws) => {
        this.showCreateModal = false;
        this.loadWorkspaces();
        this.newWsTitle = '';
        this.newWsDesc = '';
      },
      error: () => this.errorMessage = 'Oluşturulamadı.'
    });
  }

  joinWorkspace(): void {
    if (!this.joinInviteCode.trim()) return;
    this.workspaceService.joinWorkspace(this.joinInviteCode).subscribe({
      next: () => {
        this.showJoinModal = false;
        this.loadWorkspaces();
        this.joinInviteCode = '';
      },
      error: (err) => this.errorMessage = err.error?.message || 'Katılamadınız.'
    });
  }


  goToWorkspace(id: number | undefined): void {
    if (id) {
      this.router.navigate(['/workspaces', id]);
    }
  }

  copyInvite(code: string | undefined): void {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.showToast('Davet kodu başarıyla kopyalandı ✓');
    });
  }

  showToast(msg: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage = msg;
    this.toastVisible = true;
    this.toastTimer = setTimeout(() => { this.toastVisible = false; }, 3000);
  }
}
