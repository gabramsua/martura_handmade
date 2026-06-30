import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { UserRole } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [AsyncPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly user$ = this.authService.user$;
  readonly requestedRole = (this.route.snapshot.queryParamMap.get('role') as UserRole | null) ?? 'customer';
  readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
  readonly loginForm = this.formBuilder.nonNullable.group({
    name: [this.requestedRole === 'admin' ? 'Virginia Admin' : 'Cliente Martura', [Validators.required]],
    email: [
      this.requestedRole === 'admin' ? 'admin@martura.test' : 'cliente@martura.test',
      [Validators.required, Validators.email],
    ],
    role: [this.requestedRole, [Validators.required]],
  });

  login(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.authService.login(this.loginForm.getRawValue());
    this.router.navigateByUrl(this.returnUrl);
  }

  logout(): void {
    this.authService.logout();
  }
}
