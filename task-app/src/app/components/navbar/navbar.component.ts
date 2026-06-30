import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SessionService } from '../../services/session.service';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, NotificationBellComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent implements OnInit {
  @Input() activeTab: 'tasks' | 'workspaces' | 'calendar' = 'tasks';
  @Output() openSession = new EventEmitter<void>();

  userName: string = '';
  userRole: string = 'user';

  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private router: Router
  ) {}

  ngOnInit() {
    this.userName = this.authService.getUserName() || 'Kullanıcı';
    this.userRole = this.authService.getRole();
  }

  getRoleBadgeClass() {
    return {
      'badge-admin': this.userRole === 'admin',
      'badge-manager': this.userRole === 'manager',
      'badge-user': this.userRole === 'user'
    };
  }

  goToTasks() {
    this.router.navigate(['/tasks']);
  }

  goToWorkspaces() {
    this.router.navigate(['/workspaces']);
  }

  goToCalendar() {
    this.router.navigate(['/calendar']);
  }

  logout() {
    this.sessionService.logoutCurrentSession().subscribe({
      next: () => this.executeLogout(),
      error: () => this.executeLogout()
    });
  }

  private executeLogout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
