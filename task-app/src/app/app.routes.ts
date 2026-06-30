import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login';
import { TasksComponent } from './pages/tasks/tasks';
import { WorkspaceListComponent } from './pages/workspace-list/workspace-list';
import { WorkspaceDetailComponent } from './pages/workspace-detail/workspace-detail';
import { CalendarComponent } from './pages/calendar/calendar';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'tasks', component: TasksComponent, canActivate: [authGuard] },
  { path: 'workspaces', component: WorkspaceListComponent, canActivate: [authGuard] },
  { path: 'workspaces/:id', component: WorkspaceDetailComponent, canActivate: [authGuard] },
  { path: 'calendar', component: CalendarComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: 'login' }
];
