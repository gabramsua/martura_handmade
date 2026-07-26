export interface HeroSlide {
  id: string;
  imageUrl: string;
  headline: string;
  caption: string;
  position: number;
  active: boolean;
}

export interface AboutArticle {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  position: number;
}

export interface ShopSettings {
  id: string;
  bizumPhone: string;
  shippingPrice: number;
  contactEmail: string;
  aboutTitle: string;
  aboutBody: string;
  aboutArticles: AboutArticle[];
  heroSlides: HeroSlide[];
}

export type ShopSettingsDraft = Omit<ShopSettings, 'id'> & {
  id?: string;
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  id: 'default',
  bizumPhone: '697748991',
  shippingPrice: 4.95,
  contactEmail: 'martura.handmade@gmail.com',
  aboutTitle: 'Sobre Martura Handmade',
  aboutBody:
    'Piezas textiles hechas a mano, con tejidos escogidos uno a uno y un ritmo de taller tranquilo. Cada pedido se prepara con mimo y posibilidad de personalización.',
  aboutArticles: [
    {
      id: 'about-1',
      eyebrow: 'Forma de trabajo',
      title: 'Piezas hechas a mano y encargos con trato directo',
      body:
        'Cada producto nace en taller, con tejidos y acabados escogidos uno a uno. Si necesitas un ajuste, una combinación concreta o un detalle especial, la sección de consultas queda abierta para eso.',
      position: 10,
    },
    {
      id: 'about-2',
      eyebrow: 'Contacto',
      title: 'martura.handmade@gmail.com',
      body:
        'También puedes escribir desde el formulario y dejar contexto del encargo, duda o idea que tengas en mente.',
      position: 20,
    },
    {
      id: 'about-3',
      eyebrow: 'Pago activo',
      title: 'Bizum al 697748991',
      body:
        'El número puede cambiar desde administración y el cliente lo ve siempre actualizado al terminar el pedido.',
      position: 30,
    },
  ],
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
