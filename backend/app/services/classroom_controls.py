"""Server-owned state; provider metadata is its realtime projection."""
from copy import deepcopy

DEFAULT_POLICY = {'chat': True, 'screen_share': False, 'unmute': True, 'waiting_room': False, 'locked': False}


def state(item):
    value = deepcopy(item.classroom_state or {})
    value['policy'] = DEFAULT_POLICY | value.get('policy', {})
    value.setdefault('members', {})
    return value


def sources(policy, host=False):
    return ['camera'] + (['microphone'] if host or policy['unmute'] else []) + (['screen_share', 'screen_share_audio'] if host or policy['screen_share'] else [])


async def project(provider, item):
    value = state(item)
    await provider.metadata(item, value)
    for participant in await provider.participants(f'classroom-{item.id}'):
        # Egress is infrastructure, never a student subject to host media policy.
        from livekit import api
        if getattr(participant, 'kind', 0) == api.ParticipantInfo.EGRESS:
            continue
        member = value['members'].get(participant.identity, {})
        if member.get('admission') in ('removed', 'rejected'):
            await provider.remove(f'classroom-{item.id}', participant.identity)
            continue
        await provider.permissions(item, participant, value)
