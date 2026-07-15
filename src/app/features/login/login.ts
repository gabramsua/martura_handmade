import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { UserRole } from '../../core/models/user.model';
import { environment } from '../../../environments/environment';
import { AlertsService } from '../../core/services/alerts.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [AsyncPipe, MatProgressSpinnerModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly formBuilder = inject(FormBuilder);
  private readonly alertsService = inject(AlertsService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly authMode = this.authService.mode;
  readonly isFirebasePopupMode = this.authMode === 'firebase';
  readonly isEmulatorMode = this.authMode === 'emulator';
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

  constructor() {
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user) {
          return;
        }

        if (this.requestedRole === 'admin' && user.role !== 'admin') {
          return;
        }

        void this.router.navigateByUrl(this.returnUrl);
      });
  }

  async login(): Promise<void> {
    if (this.requestedRole === 'admin' && !this.adminEmail) {
      this.errorMessage =
        'Falta configurar un correo administrador autorizado en el entorno antes de abrir el dashboard.';
      await this.alertsService.error('Configuración incompleta', this.errorMessage);
      return;
    }

    if (!this.isFirebasePopupMode && this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      this.errorMessage = this.getFormValidationMessage();
      await this.alertsService.error('Revisa el acceso', this.errorMessage);
      return;
    }

    try {
      this.isSubmitting = true;
      this.errorMessage = null;
      await this.authService.login(
        this.isFirebasePopupMode
          ? {
              name: '',
              email: this.requestedRole === 'admin' ? this.adminEmail : '',
              role: this.requestedRole,
            }
          : this.loginForm.getRawValue(),
      );
      await this.router.navigateByUrl(this.returnUrl);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo iniciar sesión.';
      await this.alertsService.error('No se pudo iniciar sesión', this.errorMessage);
    } finally {
      this.isSubmitting = false;
    }
  }

  async logout(): Promise<void> {
    await this.authService.logout();
  }

  get title(): string {
    return this.requestedRole === 'admin' ? 'Acceso administrador' : 'Identifícate para cerrar tu pedido';
  }

  get description(): string {
    if (this.isFirebasePopupMode) {
      return this.requestedRole === 'admin'
        ? 'Entra con Google usando el correo autorizado para gestionar catálogo, stock y pedidos.'
        : 'Entra con Google para asociar el pedido a tu cuenta y poder consultar su estado después.';
    }

    if (this.isEmulatorMode) {
      return this.requestedRole === 'admin'
        ? 'Entrarás contra el emulador local con el correo administrador configurado, sin popup de Google.'
        : 'Entrarás contra el emulador local con un usuario de pruebas para validar carrito, checkout y pedidos.';
    }

    return 'Este acceso sigue en modo mock para validar el flujo del MVP antes de conectar proveedores reales.';
  }

  get submitLabel(): string {
    if (this.isSubmitting) {
      return 'Conectando...';
    }

    if (this.isFirebasePopupMode) {
      return this.requestedRole === 'admin' ? 'Entrar con Google' : 'Continuar con Google';
    }

    if (this.isEmulatorMode) {
      return this.requestedRole === 'admin' ? 'Entrar al emulador admin' : 'Entrar al emulador';
    }

    return this.requestedRole === 'admin' ? 'Entrar al dashboard' : 'Continuar al checkout';
  }

  get submittingMessage(): string {
    if (this.isFirebasePopupMode) {
      return 'Abriendo el acceso seguro con Google...';
    }

    if (this.isEmulatorMode) {
      return 'Validando la cuenta de pruebas en el emulador...';
    }

    return 'Preparando tu acceso...';
  }

  getFieldErrorMessage(controlName: 'name' | 'email'): string | null {
    const control = this.loginForm.controls[controlName];

    if (!control.touched) {
      return null;
    }

    if (control.hasError('required')) {
      return controlName === 'name'
        ? 'Necesitamos un nombre para continuar.'
        : 'El correo es obligatorio.';
    }

    if (control.hasError('email')) {
      return 'Escribe un correo válido.';
    }

    return null;
  }

  private getFormValidationMessage(): string {
    if (this.loginForm.controls.name.invalid) {
      return 'Revisa el nombre antes de continuar.';
    }

    if (this.loginForm.controls.email.hasError('required')) {
      return 'Indica el correo con el que quieres acceder.';
    }

    if (this.loginForm.controls.email.hasError('email')) {
      return 'El correo no tiene un formato válido.';
    }

    return 'Revisa los datos de acceso antes de continuar.';
  }
}
