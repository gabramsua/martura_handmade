import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AlertsService } from '../../core/services/alerts.service';
import { ContactMessagesService } from '../../core/services/contact-messages.service';
import { ShopSettingsService } from '../../core/services/shop-settings.service';

@Component({
  selector: 'app-contact',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Contact {
  private readonly formBuilder = inject(FormBuilder);
  private readonly alertsService = inject(AlertsService);
  private readonly contactMessagesService = inject(ContactMessagesService);
  readonly shopSettingsService = inject(ShopSettingsService);

  readonly isSubmitting = signal(false);
  readonly contactForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    body: ['', [Validators.required, Validators.minLength(12)]],
  });

  async submit(): Promise<void> {
    if (this.contactForm.invalid) {
      this.contactForm.markAllAsTouched();
      await this.alertsService.error('Revisa el formulario', 'Completa nombre, correo y consulta antes de enviarla.');
      return;
    }

    try {
      this.isSubmitting.set(true);
      await this.contactMessagesService.createMessage(this.contactForm.getRawValue());
      this.contactForm.reset({
        name: '',
        email: '',
        body: '',
      });
      await this.alertsService.success(
        'Consulta enviada',
        'La consulta ha quedado registrada. Más adelante conectaremos también el envío por correo.',
      );
    } catch (error) {
      await this.alertsService.error(
        'No se pudo enviar',
        error instanceof Error ? error.message : 'La consulta no se pudo guardar.',
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
