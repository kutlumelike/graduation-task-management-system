import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.css'
})
export class EmptyStateComponent {
  @Input() title: string = 'Burası Boş';
  @Input() description: string = 'Henüz kayıt eklenmemiş.';
  @Input() type: 'task' | 'workspace' | 'file' | 'activity' | 'generic' = 'generic';
}
