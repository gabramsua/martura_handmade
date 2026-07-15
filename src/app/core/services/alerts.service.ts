import { Injectable } from '@angular/core';
import Swal from 'sweetalert2';
import type { SweetAlertIcon, SweetAlertResult } from 'sweetalert2';

@Injectable({ providedIn: 'root' })
export class AlertsService {
  async confirm(options: {
    title: string;
    text: string;
    confirmButtonText?: string;
    cancelButtonText?: string;
    icon?: SweetAlertIcon;
  }): Promise<boolean> {
    const result: SweetAlertResult = await Swal.fire({
      title: options.title,
      text: options.text,
      icon: options.icon ?? 'warning',
      showCancelButton: true,
      confirmButtonText: options.confirmButtonText ?? 'Continuar',
      cancelButtonText: options.cancelButtonText ?? 'Cancelar',
      reverseButtons: true,
      focusCancel: true,
      confirmButtonColor: '#25201d',
      cancelButtonColor: '#c9835d',
    });

    return result.isConfirmed;
  }

  async success(title: string, text?: string): Promise<void> {
    await Swal.fire({
      title,
      text,
      icon: 'success',
      confirmButtonColor: '#25201d',
    });
  }

  async error(title: string, text?: string): Promise<void> {
    await Swal.fire({
      title,
      text,
      icon: 'error',
      confirmButtonColor: '#25201d',
    });
  }

  toast(icon: SweetAlertIcon, title: string): void {
    void Swal.fire({
      toast: true,
      position: 'top-end',
      timer: 2200,
      timerProgressBar: true,
      showConfirmButton: false,
      icon,
      title,
    });
  }
}
