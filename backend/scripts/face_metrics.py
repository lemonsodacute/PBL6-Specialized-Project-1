"""Verification metrics and calibration. No models, files or application imports."""
from __future__ import annotations

import math
from numbers import Real


def _scores(values):
    result = list(values)
    if not result:
        raise ValueError('Need nonempty genuine and impostor scores; no accuracy can be reported.')
    if any(isinstance(v, bool) or not isinstance(v, Real) or not math.isfinite(v) or not -1 <= v <= 1 for v in result):
        raise ValueError('Scores must be finite real cosine values in [-1, 1].')
    return result


def operating_point(genuine, impostor, threshold: float) -> dict:
    genuine, impostor = _scores(genuine), _scores(impostor)
    # The finite nextafter(1,+inf) sentinel means reject-all, report-only.
    if isinstance(threshold, bool) or not isinstance(threshold, Real) or not math.isfinite(threshold) or not -1 <= threshold <= math.nextafter(1.0, math.inf):
        raise ValueError('Invalid cosine threshold.')
    fa = sum(s >= threshold for s in impostor)
    fr = sum(s < threshold for s in genuine)
    far, frr = fa / len(impostor), fr / len(genuine)
    return {
        'threshold': float(threshold), 'genuine_pairs': len(genuine), 'impostor_pairs': len(impostor),
        'false_accepts': fa, 'false_rejects': fr, 'far': far, 'frr': frr, 'tar': 1 - frr,
        'accuracy': 1 - (fa + fr) / (len(genuine) + len(impostor)),
        'balanced_accuracy': 1 - (far + frr) / 2,
    }


def roc_curve(genuine, impostor) -> list[dict]:
    genuine, impostor = _scores(genuine), _scores(impostor)
    groups = {}
    for label, scores in enumerate((impostor, genuine)):
        for score in scores:
            groups.setdefault(float(score), [0, 0])[label] += 1
    result = [{'threshold': math.nextafter(max(groups), math.inf), 'far': 0.0, 'frr': 1.0, 'tar': 0.0}]
    accepted_good = accepted_bad = 0
    for threshold in sorted(groups, reverse=True):
        bad, good = groups[threshold]
        accepted_bad += bad
        accepted_good += good
        tar = accepted_good / len(genuine)
        result.append({'threshold': threshold, 'far': accepted_bad / len(impostor), 'frr': 1 - tar, 'tar': tar})
    return result


def curve_summary(curve: list[dict]) -> dict:
    auc = sum((b['far'] - a['far']) * (a['tar'] + b['tar']) / 2 for a, b in zip(curve, curve[1:]))
    # A deterministic deployable point is distinct from the interpolated EER.
    nearest = min(curve, key=lambda p: (abs(p['far'] - p['frr']), p['far'], -p['threshold']))
    eer = None
    for a, b in zip(curve, curve[1:]):
        da, db = a['far'] - a['frr'], b['far'] - b['frr']
        if da <= 0 <= db:
            weight = 0.0 if da == db else -da / (db - da)
            eer = a['far'] + weight * (b['far'] - a['far'])
            break
    if eer is None:
        raise ValueError('Incomplete ROC curve.')
    return {
        'roc_auc': auc, 'eer_interpolated': eer,
        'eer_nearest_empirical': (nearest['far'] + nearest['frr']) / 2,
        'threshold_at_nearest_eer': nearest['threshold'],
        'eer_point_far': nearest['far'], 'eer_point_frr': nearest['frr'],
        'eer_point_gap': abs(nearest['far'] - nearest['frr']),
    }


def _target(value: float) -> None:
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or not 0 <= value < 1:
        raise ValueError('Target FAR must be finite and in [0,1).')


def security_threshold(curve, target_far: float) -> float:
    _target(target_far)
    feasible = [p for p in curve if p['far'] <= target_far]
    # Minimize FRR under the requested empirical FAR; conservative tie break.
    return max(feasible, key=lambda p: (p['tar'], -p['far'], p['threshold']))['threshold']


def calibrate(genuine, impostor, target_far: float) -> dict:
    """Caller must pass calibration data ONLY; thresholds are then frozen."""
    curve = roc_curve(genuine, impostor)
    summary = curve_summary(curve)
    balanced = min(curve, key=lambda p: (p['far'] + p['frr'], p['far'], -p['threshold']))
    return {
        'eer': summary['threshold_at_nearest_eer'],
        'security': security_threshold(curve, target_far),
        'ux_balanced': balanced['threshold'],
    }


def distribution(values) -> dict:
    values = sorted(_scores(values))

    def quantile(q):
        position = (len(values) - 1) * q
        low, high = math.floor(position), math.ceil(position)
        return values[low] + (values[high] - values[low]) * (position - low)

    mean = sum(values) / len(values)
    return {
        'count': len(values), 'min': values[0], 'max': values[-1], 'mean': mean,
        'std_population': math.sqrt(sum((v - mean) ** 2 for v in values) / len(values)),
        'p05': quantile(.05), 'median': quantile(.5), 'p95': quantile(.95),
    }


def far_resolution(impostor_count: int) -> dict:
    if type(impostor_count) is not int or impostor_count < 1:
        raise ValueError('Need impostor comparisons to assess empirical FAR resolution.')
    return {
        'empirical_far_step': 1 / impostor_count,
        'zero_accept_iid_95_upper_bound_illustration': -math.expm1(math.log(.05) / impostor_count),
        'warning': 'Pairs share identities/images and are correlated. The IID bound is illustrative, not a valid identity-level confidence interval or guarantee.',
    }


def tar_at_far(genuine, impostor, targets=(.1, .05, .01), *, min_expected_events=10) -> list[dict]:
    """Exploratory ROC operating points; require N*target>=10 as a size heuristic.

    This does not make dependent pairs independent or establish confidence.
    Test-set ROC points are descriptive and must never become chosen thresholds.
    """
    curve = roc_curve(genuine, impostor)
    result = []
    for target in targets:
        _target(target)
        sufficient = len(impostor) * target >= min_expected_events
        item = {'target_far': target, 'supported_by_pair_count_heuristic': sufficient,
                'minimum_impostor_pairs': math.ceil(min_expected_events / target) if target else None,
                'tar': None, 'observed_far': None}
        if sufficient:
            point = max((p for p in curve if p['far'] <= target), key=lambda p: (p['tar'], -p['far']))
            item.update(tar=point['tar'], observed_far=point['far'])
        result.append(item)
    return result


def decision_gate(calibration_security: dict, latency_p95_ms: float, *, max_far=None, max_frr=None, max_latency_ms=None) -> dict:
    """Review aid using calibration only. Never launches training or deploys."""
    if any(v is None for v in (max_far, max_frr, max_latency_ms)):
        return {'status': 'AWAITING_REQUIREMENTS', 'training_needed': None,
                'reason': 'No complete FAR/FRR/CPU latency acceptance requirements supplied.'}
    _target(max_far)
    _target(max_frr)
    if not math.isfinite(max_latency_ms) or max_latency_ms <= 0:
        raise ValueError('Latency requirement must be positive and finite.')
    failures = []
    if calibration_security['far'] > max_far:
        failures.append('FAR')
    if calibration_security['end_to_end_genuine_nonaccept_rate'] > max_frr:
        failures.append('FRR including quality failures')
    if latency_p95_ms > max_latency_ms:
        failures.append('CPU extraction p95')
    if failures:
        return {'status': 'REVIEW_EXPERIMENT', 'training_needed': None, 'failed_requirements': failures,
                'reason': 'Review quality failures, overlap and resource costs before authorizing a controlled candidate experiment.'}
    return {'status': 'KEEP_SFACE', 'training_needed': False,
            'reason': 'Training/fine-tuning không chứng minh được lợi ích cần thiết.',
            'limitation': 'Empirical calibration check only; examine held-out results and statistical limitations before any production decision.'}
