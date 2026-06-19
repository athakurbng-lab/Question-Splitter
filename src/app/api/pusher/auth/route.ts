import { NextRequest, NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusher-server';
import { getSession } from '@/actions/auth';

export async function POST(req: NextRequest) {
  const session = await getSession();
  
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await req.text();
  const params = new URLSearchParams(body);
  const socketId = params.get('socket_id');
  const channelName = params.get('channel_name');

  if (!socketId || !channelName) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  // Ensure user can only subscribe to their own private channel
  if (channelName !== `private-user-${session.userId}`) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName);
  return NextResponse.json(authResponse);
}
