import { EventEmitter } from 'node:events';

// Event real-time untuk inbox (dikirim ke browser via Server-Sent Events).
export type CrmEvent =
  | { type: 'message'; conversationId: string; ownerId: string | null }
  | { type: 'conversation'; conversationId: string; ownerId: string | null }
  | { type: 'lead'; leadId: string; ownerId: string | null }
  | { type: 'notification'; userId: string }
  | { type: 'task'; userId: string };

export class EventBus {
  private em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(1000);
  }
  emit(e: CrmEvent) {
    this.em.emit('event', e);
  }
  on(fn: (e: CrmEvent) => void) {
    this.em.on('event', fn);
    return () => this.em.off('event', fn);
  }
}
