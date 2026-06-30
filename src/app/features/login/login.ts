import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { UserRole } from '../../core/models/user.model';
import { environment } from '../../../environments/environment';
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

  readonly authMode = this.authService.mode;
  readonly isFirebaseMode = this.authMode === 'firebase';
  readonly user$ = this.authService.user$;
  readonly requestedRole = (this.route.snapshot.queryParamMap.get('role') as UserRole | null) ?? 'customer';
  readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
  readonly adminEmail = environment.firebase.adminEmails[0] ?? '';
  readonly loginForm = this.formBuilder.nonNullable.group({
    name: [this.requestedRole === 'admin' ? 'Virginia Admin' : 'Cliente Martura', [Validators.required]],
    email: [
      this.requestedRole === 'admin' ? this.adminEmail : 'cliente@martura.test',
      [Validators.required, Validators.email],
    ],
    role: [this.requestedRole, [Validators.required]],
  });
  errorMessage: string | null = null;
  isSubmitting = false;

  async login(): Promise<void> {
    if (!this.isFirebaseMode && this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    try {
      this.isSubmitting = true;
      this.errorMessage = null;
      await this.authService.login(
        this.isFirebaseMode
          ? {
              name: this.requestedRole === 'admin' ? 'Martura Admin' : 'Cliente Martura',
              email: this.requestedRole === 'admin' ? this.adminEmail : '',
              role: this.requestedRole,
            }
          : this.loginForm.getRawValue(),
      );
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo iniciar sesion.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async logout(): Promise<void> {
    await this.authService.logout();
  }

  get title(): string {
    return this.requestedRole === 'admin' ? 'Acceso administrador' : 'Identificate para cerrar pedido';
  }

  get description(): string {
    if (this.isFirebaseMode) {
      return this.requestedRole === 'admin'
        ? 'Entra con Google usando el correo autorizado para gestionar catalogo, stock y pedidos.'
        : 'Entra con Google para asociar el pedido a tu cuenta y poder consultar su estado despues.';
    }

    return 'Este login sigue en modo mock para validar el flujo del MVP antes de conectar proveedores reales.';
  }

  get submitLabel(): string {
    if (this.isSubmitting) {
      return 'Conectando...';
    }

    if (this.isFirebaseMode) {
      return this.requestedRole === 'admin' ? 'Entrar con Google' : 'Continuar con Google';
    }

    return this.requestedRole === 'admin' ? 'Entrar al dashboard' : 'Continuar al checkout';
  }
}
