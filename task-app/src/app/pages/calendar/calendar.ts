import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TaskService } from '../../services/task.service';
import { WorkspaceService } from '../../services/workspace.service';
import { Task } from '../../models/task.model';
import { WorkspaceTask } from '../../models/workspace.model';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';


export interface CalendarEvent {
  id: number;
  title: string;
  date: Date;
  type: 'personal' | 'workspace';
  workspaceName?: string;
  status: string;
  priority?: string;
  originalTask: any;
  isApproaching: boolean;
  isOverdue: boolean;
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css'
})
export class CalendarComponent implements OnInit {
  viewMode: 'month' | 'week' | 'day' = 'month';
  currentDate: Date = new Date();
  
  events: CalendarEvent[] = [];
  isLoading: boolean = false;
  
  // Grid structures
  calendarDays: { date: Date, isCurrentMonth: boolean, events: CalendarEvent[] }[] = [];
  weekDays: { date: Date, events: CalendarEvent[] }[] = [];
  dayEvents: CalendarEvent[] = [];

  // User
  userName: string = '';
  userRole: string = 'user';

  // Modal
  selectedEvent: CalendarEvent | null = null;
  isModalOpen: boolean = false;

  constructor(
    private router: Router,
    private taskService: TaskService,
    private workspaceService: WorkspaceService
  ) {}

  ngOnInit(): void {
    this.userName = localStorage.getItem('userName') || 'Kullanıcı';
    this.userRole = localStorage.getItem('role') || 'user';
    this.loadAllTasks();
  }

  loadAllTasks(): void {
    this.isLoading = true;
    
    // 1. Get Personal Tasks
    const personalTasks$ = this.taskService.getTasks().pipe(
      catchError(() => of([]))
    );

    // 2. Get Workspaces, then tasks for each workspace
    const workspaceTasks$ = this.workspaceService.getWorkspaces().pipe(
      switchMap(workspaces => {
        if (!workspaces || workspaces.length === 0) return of([]);
        const taskRequests = workspaces.map(ws => 
          this.workspaceService.getWorkspaceTasks(ws.id!).pipe(
            map(tasks => tasks.map(t => ({ ...t, workspaceName: ws.title }))),
            catchError(() => of([]))
          )
        );
        return forkJoin(taskRequests).pipe(
          map(results => results.flat())
        );
      }),
      catchError(() => of([]))
    );

    forkJoin([personalTasks$, workspaceTasks$]).subscribe(([pTasks, wTasks]) => {
      this.processTasks(pTasks, wTasks);
      this.isLoading = false;
      this.generateCalendar();
    });
  }

  processTasks(personalTasks: Task[], workspaceTasks: any[]): void {
    const allEvents: CalendarEvent[] = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const twoDaysFromNow = new Date(today);
    twoDaysFromNow.setDate(today.getDate() + 2);

    // Personal
    personalTasks.forEach(pt => {
      if (!pt.duedate) return;
      const dateParts = pt.duedate.split('-'); // YYYY-MM-DD
      if (dateParts.length !== 3) return;
      const tDate = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]));
      tDate.setHours(0,0,0,0);
      
      const isOverdue = tDate < today && pt.status !== 'Tamamlandı';
      const isApproaching = tDate >= today && tDate <= twoDaysFromNow && pt.status !== 'Tamamlandı';
      
      allEvents.push({
        id: pt.id!,
        title: pt.title,
        date: tDate,
        type: 'personal',
        status: pt.status,
        priority: pt.priority,
        originalTask: pt,
        isApproaching,
        isOverdue
      });
    });

    // Workspace
    workspaceTasks.forEach(wt => {
      if (!wt.due_date) return;
      // Handle timestamp or YYYY-MM-DD
      const tDate = new Date(wt.due_date);
      tDate.setHours(0,0,0,0);
      
      const isOverdue = tDate < today && wt.status !== 'Tamamlandı';
      const isApproaching = tDate >= today && tDate <= twoDaysFromNow && wt.status !== 'Tamamlandı';

      allEvents.push({
        id: wt.id!,
        title: wt.title,
        date: tDate,
        type: 'workspace',
        workspaceName: wt.workspaceName,
        status: wt.status,
        originalTask: wt,
        isApproaching,
        isOverdue
      });
    });

    this.events = allEvents;
  }

  // --- View Generators ---

  generateCalendar(): void {
    if (this.viewMode === 'month') {
      this.generateMonthView();
    } else if (this.viewMode === 'week') {
      this.generateWeekView();
    } else {
      this.generateDayView();
    }
  }

  generateMonthView(): void {
    this.calendarDays = [];
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    let startDayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    // Make Monday first day (0 = Mon, 6 = Sun)
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

    // Previous month days
    for (let i = startDayOfWeek; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      this.calendarDays.push({
        date: d,
        isCurrentMonth: false,
        events: this.getEventsForDate(d)
      });
    }

    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const d = new Date(year, month, i);
      this.calendarDays.push({
        date: d,
        isCurrentMonth: true,
        events: this.getEventsForDate(d)
      });
    }

    // Next month days to fill 42 cells (6 rows)
    const remaining = 42 - this.calendarDays.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      this.calendarDays.push({
        date: d,
        isCurrentMonth: false,
        events: this.getEventsForDate(d)
      });
    }
  }

  generateWeekView(): void {
    this.weekDays = [];
    const curr = new Date(this.currentDate);
    const day = curr.getDay(); // 0=Sun, 1=Mon
    const diff = curr.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    
    const monday = new Date(curr.setDate(diff));
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      this.weekDays.push({
        date: d,
        events: this.getEventsForDate(d)
      });
    }
  }

  generateDayView(): void {
    const d = new Date(this.currentDate);
    this.dayEvents = this.getEventsForDate(d);
  }

  getEventsForDate(date: Date): CalendarEvent[] {
    return this.events.filter(e => 
      e.date.getDate() === date.getDate() &&
      e.date.getMonth() === date.getMonth() &&
      e.date.getFullYear() === date.getFullYear()
    );
  }

  // --- Upcoming Panel Data ---
  get overdueTasks(): CalendarEvent[] {
    return this.events.filter(e => e.isOverdue).sort((a,b) => a.date.getTime() - b.date.getTime());
  }

  get todayTasks(): CalendarEvent[] {
    const today = new Date();
    return this.events.filter(e => 
      !e.isOverdue &&
      e.status !== 'Tamamlandı' &&
      e.date.getDate() === today.getDate() &&
      e.date.getMonth() === today.getMonth() &&
      e.date.getFullYear() === today.getFullYear()
    ).sort((a,b) => a.date.getTime() - b.date.getTime());
  }

  get tomorrowTasks(): CalendarEvent[] {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.events.filter(e => 
      !e.isOverdue &&
      e.status !== 'Tamamlandı' &&
      e.date.getDate() === tomorrow.getDate() &&
      e.date.getMonth() === tomorrow.getMonth() &&
      e.date.getFullYear() === tomorrow.getFullYear()
    ).sort((a,b) => a.date.getTime() - b.date.getTime());
  }

  get thisWeekTasks(): CalendarEvent[] {
    const today = new Date();
    today.setHours(0,0,0,0);
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + 7);
    
    // We already have today and tomorrow, let's just get the rest of the 7 days
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.events.filter(e => 
      !e.isOverdue &&
      e.status !== 'Tamamlandı' &&
      e.date > tomorrow && 
      e.date <= endOfWeek
    ).sort((a,b) => a.date.getTime() - b.date.getTime());
  }

  // --- Navigation ---

  setViewMode(mode: 'month' | 'week' | 'day'): void {
    this.viewMode = mode;
    this.generateCalendar();
  }

  prev(): void {
    if (this.viewMode === 'month') {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    } else if (this.viewMode === 'week') {
      this.currentDate.setDate(this.currentDate.getDate() - 7);
    } else {
      this.currentDate.setDate(this.currentDate.getDate() - 1);
    }
    this.currentDate = new Date(this.currentDate); // trigger change
    this.generateCalendar();
  }

  next(): void {
    if (this.viewMode === 'month') {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    } else if (this.viewMode === 'week') {
      this.currentDate.setDate(this.currentDate.getDate() + 7);
    } else {
      this.currentDate.setDate(this.currentDate.getDate() + 1);
    }
    this.currentDate = new Date(this.currentDate);
    this.generateCalendar();
  }

  today(): void {
    this.currentDate = new Date();
    this.generateCalendar();
  }

  // --- Helpers ---
  
  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  getMonthName(): string {
    return this.currentDate.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
  }

  getWeekRange(): string {
    if (this.weekDays.length === 0) return '';
    const first = this.weekDays[0].date;
    const last = this.weekDays[6].date;
    const fStr = first.toLocaleString('tr-TR', { day: 'numeric', month: 'short' });
    const lStr = last.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${fStr} - ${lStr}`;
  }

  getDayName(): string {
    return this.currentDate.toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  }

  openEventModal(event: CalendarEvent, clickEvent: Event): void {
    clickEvent.stopPropagation();
    this.selectedEvent = event;
    this.isModalOpen = true;
  }

  closeModal(): void {
    this.isModalOpen = false;
    this.selectedEvent = null;
  }
}
