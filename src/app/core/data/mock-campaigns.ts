import { Campaign } from '../models/campaign.model';

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp-verano-2026',
    name: 'Campana Verano 2026',
    badge: 'Verano',
    description: 'Seleccion de temporada con descuento suave para piezas ligeras y de viaje.',
    discountType: 'percentage',
    discountValue: 15,
    active: true,
    startsAt: new Date('2026-06-01'),
    endsAt: new Date('2026-08-31'),
  },
  {
    id: 'cmp-vuelta-taller-2026',
    name: 'Vuelta al Taller',
    badge: 'Septiembre',
    description: 'Campana preparada para la siguiente temporada.',
    discountType: 'fixed',
    discountValue: 6,
    active: false,
    startsAt: new Date('2026-09-01'),
    endsAt: new Date('2026-09-30'),
  },
];
