import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ShopSettingsService } from '../../core/services/shop-settings.service';

@Component({
  selector: 'app-about',
  imports: [AsyncPipe, RouterLink],
  templateUrl: './about.html',
  styleUrl: './about.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class About {
  readonly shopSettingsService = inject(ShopSettingsService);
  readonly settings$ = this.shopSettingsService.settings$;
}
