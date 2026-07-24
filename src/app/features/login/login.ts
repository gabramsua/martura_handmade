import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

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
  readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/admin';
  readonly adminEmail = environment.firebase.adminEmails[0] ?? '';
  readonly loginForm = this.formBuilder.nonNullable.group({
    name: ['Virginia Admin', [Validators.required]],
    email: [this.adminEmail, [Validators.required, Validators.email]],
    role: ['admin' as const, [Validators.required]],
  });
  errorMessage: string | null = null;
  isSubmitting = false;

  constructor() {
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (user?.role === 'admin') {
          void this.router.navigateByUrl(this.returnUrl);
        }
      });
  }

  async login(): Promise<void> {
    if (!this.adminEmail) {
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
              email: this.adminEmail,
              role: 'admin',
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
    return 'Acceso administrador';
  }

  get description(): string {
    if (this.isFirebasePopupMode) {
      return 'Entra con Google usando el correo autorizado para gestionar catálogo, pedidos, promociones y ajustes.';
    }

    if (this.isEmulatorMode) {
      return 'Entrarás contra el emulador local con el correo administrador configurado, sin popup de Google.';
    }

    return 'Este acceso sigue en modo mock para validar la gestión interna antes de cerrar integraciones finales.';
  }

  get submitLabel(): string {
    if (this.isSubmitting) {
      return 'Conectando...';
    }

    if (this.isFirebasePopupMode) {
      return 'Entrar con Google';
    }

    if (this.isEmulatorMode) {
      return 'Entrar al emulador admin';
    }

    return 'Entrar al dashboard';
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
