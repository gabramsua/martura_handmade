export interface HeroSlide {
  id: string;
  imageUrl: string;
  headline: string;
  caption: string;
  position: number;
  active: boolean;
}

export interface ShopSettings {
  id: string;
  bizumPhone: string;
  shippingPrice: number;
  contactEmail: string;
  aboutTitle: string;
  aboutBody: string;
  heroSlides: HeroSlide[];
}

export type ShopSettingsDraft = Omit<ShopSettings, 'id'> & {
  id?: string;
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  id: 'default',
  bizumPhone: '600000000',
  shippingPrice: 4.95,
  contactEmail: 'gabramsua@gmail.com',
  aboutTitle: 'Sobre Martura Handmade',
  aboutBody:
    'Piezas textiles hechas a mano, con tejidos escogidos uno a uno y un ritmo de taller tranquilo. Cada pedido se prepara con mimo y posibilidad de personalización.',
  heroSlides: [
    {
      id: 'hero-1',
      imageUrl: 'assets/catalog/pack-totebag-neceser-monedero.png',
      headline: 'Hecho a mano para acompañarte de verdad',
      caption: 'Bolsos, neceseres y detalles textiles con producción cuidada y series pequeñas.',
      position: 10,
      active: true,
    },
    {
      id: 'hero-2',
      imageUrl: 'assets/catalog/funda-con-asas-volante.png',
      headline: 'Piezas prácticas con personalidad',
      caption: 'Diseños pensados para el día a día, los regalos y los encargos especiales.',
      position: 20,
      active: true,
    },
    {
      id: 'hero-3',
      imageUrl: 'assets/catalog/totebag-infantil-saquito.png',
      headline: 'Catálogo vivo y personalizable',
      caption: 'Partimos del catálogo, pero el taller sigue abierto a ajustes y combinaciones.',
      position: 30,
      active: true,
    },
  ],
};
