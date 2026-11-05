"""Prepare private local Egress configuration; never print recording credentials."""
import argparse
import asyncio
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def check_idle():
    from app.services.classroom_provider import LiveKitProvider
    from livekit import api
    async with LiveKitProvider()._client() as client:
        rooms = await client.room.list_rooms(api.ListRoomsRequest())
        if any(room.num_participants for room in rooms.rooms):
            raise SystemExit('An active classroom exists. Stop its meeting before restarting the local SFU.')
    print('No connected classroom participants; local SFU restart is safe.')


def configure(node_ip):
    from app.core.config import get_settings
    settings = get_settings()
    if settings.LIVEKIT_URL not in ('ws://localhost:7880', 'ws://127.0.0.1:7880'):
        raise SystemExit('This helper only configures the existing local SFU. Configure Egress beside a remote SFU separately.')
    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise SystemExit('Configure the existing classroom provider first.')
    # All configurable values here are server-owned. Config stays under private/.
    import json
    private = ROOT / 'private' / 'livekit-recording'
    private.mkdir(parents=True, exist_ok=True)
    settings.RECORDING_STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    config = f'''api_key: {json.dumps(settings.LIVEKIT_API_KEY)}
api_secret: {json.dumps(settings.LIVEKIT_API_SECRET)}
ws_url: ws://host.docker.internal:7880
insecure: true
health_port: 7989
redis:
  address: redis:6379
logging:
  level: warn
'''
    (private / 'egress.yaml').write_text(config, encoding='utf-8')
    env = ROOT / '.env'
    content = env.read_text(encoding='utf-8')
    updates = {'CLASS_RECORDING_ENABLED': 'true', 'LIVEKIT_EGRESS_HEALTH_URL': 'http://127.0.0.1:7989',
        'LIVEKIT_EGRESS_OUTPUT_ROOT': '/out', 'LIVEKIT_REDIS_ADDRESS': '127.0.0.1:6382', 'LIVEKIT_NODE_IP': node_ip}
    for key, value in updates.items():
        if re.search(rf'^{key}=.*$', content, re.M):
            content = re.sub(rf'^{key}=.*$', lambda _: f'{key}={value}', content, flags=re.M)
        else:
            content = content.rstrip() + f'\n{key}={value}\n'
    env.write_text(content, encoding='utf-8')
    print('Private Egress config prepared. Recording remains opt-in for every class.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-idle', action='store_true')
    parser.add_argument('--node-ip')
    args = parser.parse_args()
    if args.check_idle:
        asyncio.run(check_idle())
    elif args.node_ip:
        configure(args.node_ip)
    else:
        parser.error('Supply --check-idle or --node-ip.')
