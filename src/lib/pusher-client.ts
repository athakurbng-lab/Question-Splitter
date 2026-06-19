import PusherClient from 'pusher-js';

let pusherClientInstance: PusherClient | null = null;

export const getPusherClient = () => {
  if (!pusherClientInstance) {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    if (!key) {
      console.warn('NEXT_PUBLIC_PUSHER_KEY is not defined. Pusher features will be disabled.');
      return null;
    }
    pusherClientInstance = new PusherClient(key, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
      authEndpoint: '/api/pusher/auth',
    });
  }
  return pusherClientInstance;
};
