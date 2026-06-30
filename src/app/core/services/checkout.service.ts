import { Injectable, inject } from '@angular/core';

import { CartSummary } from '../models/cart.model';
import { cartItemToOrderItem, CheckoutOrder, CustomerContact } from '../models/order.model';
import { CampaignsService } from './campaigns.service';

const SELLER_WHATSAPP = '34600000000';

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  private readonly campaignsService = inject(CampaignsService);

  buildOrder(summary: CartSummary, customer: CustomerContact, userId: string): CheckoutOrder {
    const now = new Date();

    return {
      id: `order-${Date.now()}`,
      userId,
      customer,
      items: summary.items.map((item) =>
        cartItemToOrderItem(item, this.campaignsService.activeCampaignsSnapshot),
      ),
      subtotal: summary.subtotal,
      shipping: summary.shipping,
      total: summary.total,
      channel: 'whatsapp',
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
  }

  buildWhatsappUrl(order: CheckoutOrder): string {
    const items = order.items
      .map(
        (item) =>
          `- ${item.quantity} x ${item.productName} (${item.variant}) - ${this.formatCurrency(item.lineTotal)}`,
      )
      .join('\n');
    const notes = order.customer.notes ? `\nNotas: ${order.customer.notes}` : '';
    const deliveryBlock = order.customer.deliveryMethod === 'pickup'
      ? 'Entrega: Recogida en taller'
      : [
          'Entrega: Envio',
          `Direccion: ${order.customer.addressLine1 ?? 'Sin direccion'}`,
          `CP y ciudad: ${order.customer.postalCode} ${order.customer.city}`,
          `Provincia: ${order.customer.province}`,
        ].join('\n');
    const message = [
      '*Nuevo Pedido - Martura Handmade*',
      `Cliente: ${order.customer.name}`,
      `Telefono: ${order.customer.phone}`,
      `Email: ${order.customer.email}`,
      deliveryBlock,
      notes ? `Notas: ${order.customer.notes}` : null,
      '-------------------------',
      items,
      '-------------------------',
      `Subtotal: ${this.formatCurrency(order.subtotal)}`,
      `Envio: ${this.formatCurrency(order.shipping)}`,
      `*Total: ${this.formatCurrency(order.total)}*`,
    ]
      .filter((line): line is string => !!line)
      .join('\n');

    return `https://wa.me/${SELLER_WHATSAPP}?text=${encodeURIComponent(message)}`;
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
  }
}
