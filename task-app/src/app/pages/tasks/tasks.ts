import { Component, OnInit, OnDestroy, HostListener, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TaskService } from '../../services/task.service';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';
import { FileService } from '../../services/file.service';
import { AdminService } from '../../services/admin.service';
import { SessionService } from '../../services/session.service';
import { Task } from '../../models/task.model';
import { TaskFile } from '../../models/file.model';
import { User } from '../../models/user.model';
import { Session } from '../../models/session.model';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [FormsModule, CommonModule, NotificationBellComponent, NavbarComponent, EmptyStateComponent],
  templateUrl: './tasks.html',
  styleUrl: './tasks.css'
})
export class TasksComponent implements OnInit, OnDestroy {
  tasks: Task[] = [];
  users: User[] = [];
  taskFiles: { [key: number]: TaskFile[] } = {};
  
  // App State
  userName: string = '';
  userRole: string = 'user';
  errorMessage: string = '';
  isLoading: boolean = false;
  viewMode: 'list' | 'kanban' = 'list';


  // Filter, Search & Focus
  currentFilter: string = 'All';
  searchQuery: string = '';
  focusMode: boolean = false;
  
  // Advanced Filters
  filterPriority: string = '';
  filterCategory: string = '';

  // Stats & Smart Dashboard Data
  totalTasks: number = 0;
  activeTasks: number = 0;
  completedTasks: number = 0;
  overdueTasks: number = 0;
  progressPercentage: number = 0;
  smartInsight: string = '';
  topPriorities: Task[] = [];
  upcomingTasks: Task[] = [];
  activityHistory: { message: string; time: string }[] = [];

  // Modal & Form State
  isModalOpen: boolean = false;
  editingTaskId: number | null = null;
  newTaskTitle: string = '';
  newTaskDescription: string = '';
  newTaskDueDate: string = '';
  newTaskStatus: string = 'Bekliyor';
  newTaskPriority: string = 'Medium';
  newTaskCategory: string = 'General';
  newTaskAssignTo: number | null = null;
  newTaskReminder: string = '';
  
  // Sessions State
  isSessionModalOpen: boolean = false;
  activeSessions: Session[] = [];
  
  // Upload State
  selectedFile: File | null = null;
  uploading: boolean = false;

  // Kanban Drag State
  draggedTask: Task | null = null;

  // Constants
  priorities = ['Low', 'Medium', 'High', 'Urgent'];
  categories = ['General', 'Work', 'Personal', 'Study'];
  
  private notifInterval: any;

  constructor(
    private taskService: TaskService,
    public authService: AuthService,
    private fileService: FileService,
    private adminService: AdminService,
    private sessionService: SessionService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.userName = this.authService.getUserName() || 'Kullanıcı';
    this.userRole = this.authService.getRole();
    
    
    this.loadTasks();
    
    if (this.userRole === 'admin' || this.userRole === 'manager') {
      this.loadUsers();
    }
  }
  
  ngOnDestroy(): void {
  }

  loadTasks(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    const filters = {
      search: this.searchQuery || undefined,
      priority: this.filterPriority || undefined,
      category: this.filterCategory || undefined
    };

    this.taskService.getTasks(filters).subscribe({
      next: (data) => {
        this.tasks = data;
        // Fetch files for tasks
        this.tasks.forEach(task => {
          if (task.id) this.loadFileForTask(task.id);
        });
        
        this.calculateDashboardData();
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Görevler alınamadı:', err);
        this.errorMessage = 'Görevler yüklenemedi.';
        this.isLoading = false;
      }
    });
  }
  
  loadUsers(): void {
    this.adminService.getUsers().subscribe({
      next: (data) => {
        this.users = data;
      },
      error: (err) => console.error('Kullanıcılar alınamadı', err)
    });
  }
  
  loadFileForTask(taskId: number): void {
    this.fileService.getTaskFiles(taskId).subscribe({
      next: (files) => {
        this.taskFiles[taskId] = files;
      }
    });
  }
  
  // --- Kanban Logic ---
  get pendingTasks(): Task[] { return this.filteredTasks.filter(t => t.status === 'Bekliyor'); }
  get inProgressTasks(): Task[] { return this.filteredTasks.filter(t => t.status === 'Devam Ediyor'); }
  get completedTasksFiltered(): Task[] { return this.filteredTasks.filter(t => t.status === 'Tamamlandı'); }

  onDragStart(task: Task): void {
    this.draggedTask = task;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault(); // allow drop
  }

  onDrop(event: DragEvent, newStatus: string): void {
    event.preventDefault();
    if (this.draggedTask && this.draggedTask.status !== newStatus) {
      const oldStatus = this.draggedTask.status;
      this.draggedTask.status = newStatus; // Optimistic update
      
      this.taskService.updateTask(this.draggedTask.id!, this.draggedTask).subscribe({
        next: () => {
          this.addActivity(`Görev "${this.draggedTask?.title}" durumu "${newStatus}" olarak güncellendi.`);
          this.calculateDashboardData();
          this.draggedTask = null;
        },
        error: (err) => {
          this.draggedTask!.status = oldStatus; // Revert
          this.errorMessage = 'Durum güncellenirken bir hata oluştu.';
          this.draggedTask = null;
        }
      });
    } else {
       this.draggedTask = null;
    }
  }

  // --- Calculations & Insights ---
  calculateDashboardData(): void {
    this.totalTasks = this.tasks.length;
    this.completedTasks = this.tasks.filter(t => t.status === 'Tamamlandı').length;
    this.activeTasks = this.tasks.filter(t => t.status === 'Devam Ediyor').length;
    this.overdueTasks = this.tasks.filter(t => this.isOverdue(t)).length;
    
    this.progressPercentage = this.totalTasks === 0 ? 0 : Math.round((this.completedTasks / this.totalTasks) * 100);

    // Smart Insight Generation
    if (this.totalTasks === 0) {
      this.smartInsight = 'Temiz bir sayfa! İlk görevini ekleyerek güne başla. ✨';
    } else if (this.overdueTasks > 0) {
      this.smartInsight = `Dikkat! Gecikmiş ${this.overdueTasks} görevin var. Hemen ilgilenmelisin. 🚨`;
    } else if (this.progressPercentage >= 80) {
      this.smartInsight = 'Harika gidiyorsun! Görevlerinin çoğunu tamamladın. 🚀';
    } else {
      const pending = this.totalTasks - this.completedTasks;
      this.smartInsight = `Bugün odaklanman gereken ${pending} görevin var. Başarabilirsin! 💪`;
    }

    // Top Priorities
    this.topPriorities = this.tasks
      .filter(t => t.status !== 'Tamamlandı')
      .sort((a, b) => {
        const priorityScore: any = { 'Urgent': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
        const scoreA = priorityScore[a.priority || 'Medium'];
        const scoreB = priorityScore[b.priority || 'Medium'];
        if (scoreA !== scoreB) return scoreB - scoreA;
        if (a.duedate && b.duedate) return new Date(a.duedate).getTime() - new Date(b.duedate).getTime();
        return 0;
      })
      .slice(0, 3);

    // Upcoming tasks
    const now = new Date().setHours(0,0,0,0);
    this.upcomingTasks = this.tasks
      .filter(t => t.status !== 'Tamamlandı' && t.duedate && new Date(t.duedate).getTime() >= now)
      .sort((a, b) => new Date(a.duedate!).getTime() - new Date(b.duedate!).getTime())
      .slice(0, 4);
  }

  addActivity(message: string): void {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.activityHistory.unshift({ message, time });
    if (this.activityHistory.length > 5) this.activityHistory.pop();
  }

  isOverdue(task: Task): boolean {
    if (!task.duedate || task.status === 'Tamamlandı') return false;
    const due = new Date(task.duedate).getTime();
    const today = new Date().setHours(0, 0, 0, 0);
    return due < today;
  }

  get filteredTasks(): Task[] {
    let filtered = this.tasks;

    if (this.focusMode) {
      filtered = filtered.filter(t => t.status !== 'Tamamlandı');
    }

    if (this.currentFilter !== 'All') {
      if (this.currentFilter === 'Geciken') {
        filtered = filtered.filter(t => this.isOverdue(t));
      } else {
        filtered = filtered.filter(t => t.status === this.currentFilter);
      }
    }

    // We do frontend filtering here too just in case, but backend does most of it now
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(q) || 
        (t.description && t.description.toLowerCase().includes(q))
      );
    }
    
    if (this.filterPriority) {
       filtered = filtered.filter(t => t.priority === this.filterPriority);
    }
    if (this.filterCategory) {
       filtered = filtered.filter(t => t.category === this.filterCategory);
    }

    return filtered;
  }
  applyAdvancedFilters(): void {
    this.loadTasks(); // Calls backend
  }
  
  clearFilters(): void {
    this.searchQuery = '';
    this.filterPriority = '';
    this.filterCategory = '';
    this.loadTasks();
  }

  setFilter(filter: string): void { this.currentFilter = filter; }
  toggleFocusMode(): void { this.focusMode = !this.focusMode; }
  setViewMode(mode: 'list' | 'kanban'): void { this.viewMode = mode; }

  openModal(task?: Task): void {
    this.errorMessage = '';
    this.selectedFile = null;
    if (task) {
      this.editingTaskId = task.id || null;
      this.newTaskTitle = task.title;
      this.newTaskDescription = task.description;
      this.newTaskDueDate = task.duedate ? new Date(task.duedate).toISOString().split('T')[0] : '';
      this.newTaskStatus = task.status;
      this.newTaskPriority = task.priority || 'Medium';
      this.newTaskCategory = task.category || 'General';
      this.newTaskAssignTo = task.userid || null;
      if (task.reminder_date) {
        const d = new Date(task.reminder_date);
        const tzOffset = d.getTimezoneOffset() * 60000;
        this.newTaskReminder = new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
      } else {
        this.newTaskReminder = '';
      }
    } else {
      this.editingTaskId = null;
      this.newTaskTitle = '';
      this.newTaskDescription = '';
      this.newTaskDueDate = '';
      this.newTaskStatus = 'Bekliyor';
      this.newTaskPriority = 'Medium';
      this.newTaskCategory = 'General';
      this.newTaskAssignTo = null;
      this.newTaskReminder = '';
    }
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.editingTaskId = null;
  }

  onFileSelected(event: any): void {
    if (event.target.files.length > 0) {
      this.selectedFile = event.target.files[0];
    }
  }
  
  deleteFile(fileId: number, taskId: number): void {
    if(!confirm('Dosyayı silmek istiyor musunuz?')) return;
    this.fileService.deleteFile(fileId).subscribe({
      next: () => {
        this.loadFileForTask(taskId);
      }
    });
  }

  saveTask(): void {
    if (!this.newTaskTitle.trim()) {
      this.errorMessage = 'Görev başlığı zorunludur.';
      return;
    }

    this.errorMessage = '';
    let formattedDate = null;
    if (this.newTaskDueDate) {
      const d = new Date(this.newTaskDueDate);
      if (!isNaN(d.getTime())) {
        formattedDate = d.toISOString().split('T')[0];
      }
    }
    
    let formattedReminder = null;
    if (this.newTaskReminder) {
      const r = new Date(this.newTaskReminder);
      if (!isNaN(r.getTime())) {
        formattedReminder = r.toISOString();
      }
    }

    const taskData: any = {
      title: this.newTaskTitle,
      description: this.newTaskDescription,
      duedate: formattedDate,
      status: this.newTaskStatus,
      category: this.newTaskCategory,
      priority: this.newTaskPriority,
      assign_to: this.newTaskAssignTo,
      reminder_date: formattedReminder
    };

    if (this.editingTaskId) {
      this.taskService.updateTask(this.editingTaskId, taskData).subscribe({
        next: (updated) => {
          this.handleFileUpload(updated.id!);
          this.addActivity(`Görev güncellendi: "${this.newTaskTitle}"`);
          if (this.newTaskReminder) alert('Hatırlatıcı başarıyla güncellendi!');
          this.closeModal();
          this.loadTasks();
        },
        error: (err) => {
          console.error('Görev güncellenemedi:', err);
          this.errorMessage = 'Görev güncellenirken bir hata oluştu.';
        }
      });
    } else {
      this.taskService.addTask(taskData).subscribe({
        next: (created) => {
          this.handleFileUpload(created.id!);
          this.addActivity(`Yeni görev oluşturuldu: "${this.newTaskTitle}"`);
          if (this.newTaskReminder) alert('Hatırlatıcı başarıyla oluşturuldu!');
          this.closeModal();
          this.loadTasks();
        },
        error: (err) => {
          console.error('Görev eklenemedi:', err);
          this.errorMessage = 'Görev eklenirken bir hata oluştu.';
        }
      });
    }
  }
  
  handleFileUpload(taskId: number): void {
    if (this.selectedFile) {
      this.uploading = true;
      this.fileService.uploadFile(taskId, this.selectedFile).subscribe({
        next: () => {
          this.uploading = false;
          this.selectedFile = null;
          this.loadFileForTask(taskId);
        },
        error: () => {
          this.uploading = false;
          console.error('Dosya yüklenemedi');
        }
      });
    }
  }

  deleteTask(id: any): void {
    if (!id || !confirm('Bu görevi silmek istediğinize emin misiniz?')) return;
    
    const taskTitle = this.tasks.find(t => t.id === id)?.title;
    
    this.taskService.deleteTask(id).subscribe({
      next: () => {
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.addActivity(`Görev silindi: "${taskTitle}"`);
        this.calculateDashboardData();
      },
      error: (err) => {
        console.error('Görev silinemedi:', err);
        this.errorMessage = 'Görev silinemedi.';
      }
    });
  }
  


  // --- Session Management ---
  openSessionModal(): void {
    this.isSessionModalOpen = true;
    this.loadSessions();
  }

  closeSessionModal(): void {
    this.isSessionModalOpen = false;
  }

  loadSessions(): void {
    this.sessionService.getSessions().subscribe({
      next: (data) => this.activeSessions = data,
      error: (err) => console.error('Oturumlar yüklenemedi', err)
    });
  }

  logoutAllOtherSessions(): void {
    if (confirm('Diğer tüm cihazlardan çıkış yapmak istediğinize emin misiniz?')) {
      this.sessionService.logoutAllOtherSessions().subscribe({
        next: () => {
          this.addActivity('Diğer tüm oturumlar sonlandırıldı.');
          this.loadSessions();
        },
        error: () => alert('İşlem başarısız.')
      });
    }
  }



  // --- Core Lifecycle & Init ---
}
