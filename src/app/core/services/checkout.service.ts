import { Injectable } from '@angular/core';

import { CartSummary } from '../models/cart.model';
import { cartItemToOrderItem, CheckoutOrder, CustomerContact } from '../models/order.model';

const SELLER_WHATSAPP = '34600000000';

@Injectable({ providedIn: 'root' })
export class CheckoutService {
  buildOrder(summary: CartSummary, customer: CustomerContact): CheckoutOrder {
    return {
      id: `order-${Date.now()}`,
      userId: 'mock-user',
      customer,
      items: summary.items.map(cartItemToOrderItem),
      subtotal: summary.subtotal,
      shipping: summary.shipping,
      total: summary.total,
      channel: 'whatsapp',
      status: 'draft',
      createdAt: new Date(),
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
    const message = [
      '*Nuevo Pedido - Martura Handmade*',
      `Cliente: ${order.customer.name}`,
      `Telefono: ${order.customer.phone}`,
      `Email: ${order.customer.email}`,
      `Ciudad: ${order.customer.city}${notes}`,
      '-------------------------',
      items,
      '-------------------------',
      `Subtotal: ${this.formatCurrency(order.subtotal)}`,
      `Envio: ${this.formatCurrency(order.shipping)}`,
      `*Total: ${this.formatCurrency(order.total)}*`,
    ].join('\n');

    return `https://wa.me/${SELLER_WHATSAPP}?text=${encodeURIComponent(message)}`;
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: 'EUR',
    }).format(value);
  }
}
