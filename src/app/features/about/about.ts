import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ShopSettingsService } from '../../core/services/shop-settings.service';

@Component({
  selector: 'app-about',
  imports: [AsyncPipe],
  templateUrl: './about.html',
  styleUrl: './about.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class About {
  readonly shopSettingsService = inject(ShopSettingsService);
  readonly settings$ = this.shopSettingsService.settings$;
}
