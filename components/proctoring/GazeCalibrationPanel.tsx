'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GazeCalibrationSample } from './useProctorInput';

const poses = ['LOOK_FORWARD', 'HEAD_LEFT', 'HEAD_RIGHT', 'HEAD_DOWN', 'HEAD_UP', 'EYES_LEFT', 'EYES_RIGHT'] as const;
type Pose = typeof poses[number];
type NumericSample = GazeCalibrationSample & { yaw: number; pitch: number; roll: number; gaze_ratio: number };
type Collection = { samples: NumericSample[]; discarded: number };
const fields = ['yaw', 'pitch', 'roll', 'gaze_ratio'] as const;
const fmt = (value: number | null | undefined, digits = 2) => Number.isFinite(value) ? Number(value).toFixed(digits) : 'â€”';

function summarize(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  const median = sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { count: values.length, median,
    mean, std: Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length),
    p10: quantile(.1), p90: quantile(.9), min: sorted[0], max: sorted.at(-1)! };
}

export function GazeCalibrationPanel({ sample }: { sample: GazeCalibrationSample | null }) {
  const [pose, setPose] = useState<Pose>('LOOK_FORWARD');
  const [collections, setCollections] = useState<Partial<Record<Pose, Collection>>>({});
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const lastSample = useRef('');
  const lastAccepted = useRef<NumericSample | null>(null);
  const poseStarted = useRef(0);
  const [sustainedSeconds, setSustainedSeconds] = useState(0);
  const directionStart = useRef<number | null>(null);
  const currentDirection = sample?.raw_direction || 'â€”';

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!recording) return;
      const left = Math.max(0, 6_000 - (Date.now() - poseStarted.current));
      setRemaining(Math.ceil(left / 1000));
      if (!left) setRecording(false);
    }, 100);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!sample) return;
    const stamp = Date.parse(sample.timestamp);
    if (sample.raw_direction && sample.raw_direction !== 'BINH_THUONG') {
      if (!directionStart.current || currentDirection !== lastSample.current.split('|')[1]) directionStart.current = stamp;
      setSustainedSeconds(Math.max(0, (stamp - (directionStart.current || stamp)) / 1000));
    } else { directionStart.current = null; setSustainedSeconds(0); }
    if (sample.timestamp === lastSample.current.split('|')[0]) return;
    lastSample.current = `${sample.timestamp}|${sample.raw_direction || ''}`;
    if (!recording || Date.now() - poseStarted.current < 1_000) return;
    const valid = sample.face_detected && fields.every(field => Number.isFinite(sample[field]));
    const numeric = valid ? sample as NumericSample : null;
    let jump = false;
    if (numeric && lastAccepted.current) {
      jump = Math.abs(numeric.yaw - lastAccepted.current.yaw) > 35 || Math.abs(numeric.pitch - lastAccepted.current.pitch) > 35 ||
        Math.abs(numeric.roll - lastAccepted.current.roll) > 35 || Math.abs(numeric.gaze_ratio - lastAccepted.current.gaze_ratio) > .25;
    }
    if (numeric && !jump) {
      lastAccepted.current = numeric;
      setCollections(current => ({ ...current, [pose]: { samples: [...(current[pose]?.samples ?? []), numeric], discarded: current[pose]?.discarded ?? 0 } }));
    } else {
      lastAccepted.current = null;
      setCollections(current => ({ ...current, [pose]: { samples: current[pose]?.samples ?? [], discarded: (current[pose]?.discarded ?? 0) + 1 } }));
    }
  }, [sample, recording, pose, currentDirection]);

  const neutral = useMemo(() => {
    const values = collections.LOOK_FORWARD?.samples ?? [];
    if (!values.length) return null;
    return Object.fromEntries(fields.map(field => [field, summarize(values.map(item => item[field]))?.median ?? 0])) as Record<typeof fields[number], number>;
  }, [collections]);
  const start = () => {
    lastAccepted.current = null; poseStarted.current = Date.now(); setRemaining(6); setError(''); setRecording(true);
  };
  const exportData = () => {
    const data = Object.fromEntries(poses.map(item => [item, { samples: collections[item]?.samples ?? [], discarded: collections[item]?.discarded ?? 0 }]))
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'gaze-calibration-numeric-samples.json'; link.click(); URL.revokeObjectURL(url);
  };
  const clear = () => { setCollections({}); setError(''); };

  return <section aria-label="Developer gaze calibration" style={{ position: 'fixed', zIndex: 80, right: 16, bottom: 16, width: 'min(460px, calc(100vw - 32px))', maxHeight: 'min(78vh, 760px)', overflow: 'auto', background: '#111827', color: '#f9fafb', border: '1px solid #475569', borderRadius: 14, padding: 16, boxShadow: '0 16px 48px #0007', fontSize: 13 }}>
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><div><strong>DEV Â· Gaze calibration</strong><div style={{ color: '#cbd5e1', marginTop: 3 }}>Numerical samples only Â· held in memory</div></div><span aria-live="polite">{sample?.face_detected ? 'Face detected' : 'No face'}</span></header>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 14 }}>
      {fields.map(field => <div key={field} style={{ padding: 8, borderRadius: 8, background: '#1f2937' }}><small style={{ color: '#cbd5e1' }}>{field}</small><div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{fmt(sample?.[field], field === 'gaze_ratio' ? 3 : 2)}{field !== 'gaze_ratio' ? 'Â°' : ''}</div></div>)}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, color: '#cbd5e1' }}><span>Raw direction: <b style={{ color: '#f9fafb' }}>{currentDirection}</b></span><span>Sustained: {sustainedSeconds.toFixed(1)}s</span></div>
    <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}><label htmlFor="gaze-calibration-pose">Pose</label><select id="gaze-calibration-pose" disabled={recording} value={pose} onChange={event => setPose(event.target.value as Pose)} style={{ flex: 1, padding: 8 }}>{poses.map(item => <option key={item}>{item}</option>)}</select><button type="button" onClick={start} disabled={recording || !sample} style={{ padding: '8px 12px' }}>{recording ? `${remaining}s` : 'Record 5s + settle'}</button></div>
    {error && <p role="alert">{error}</p>}
    <div style={{ marginTop: 12, overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr><th>Pose</th><th>Samples</th><th>Discarded</th><th>yaw median</th><th>pitch median</th><th>roll median</th><th>gaze median</th></tr></thead><tbody>{poses.map(item => { const rows = collections[item]?.samples ?? []; const sums = Object.fromEntries(fields.map(field => [field, summarize(rows.map(row => row[field]))])); return <tr key={item}><td>{item}</td><td>{rows.length}</td><td>{collections[item]?.discarded ?? 0}</td>{fields.map(field => <td key={field}>{fmt(sums[field]?.median, field === 'gaze_ratio' ? 3 : 1)}</td>)}</tr>; })}</tbody></table></div>
    {neutral && sample?.face_detected && <p style={{ color: '#cbd5e1' }}>Relative to LOOK_FORWARD median: yaw {fmt((sample.yaw ?? 0) - neutral.yaw)}Â°, pitch {fmt((sample.pitch ?? 0) - neutral.pitch)}Â°.</p>}
    <details style={{ marginTop: 8 }}><summary>Full collected statistics</summary>{poses.map(item => { const rows = collections[item]?.samples ?? []; return <section key={item}><h4>{item} Â· {rows.length} samples Â· {collections[item]?.discarded ?? 0} discarded</h4><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr><th>Measure</th><th>Count</th><th>Median</th><th>Mean</th><th>Std dev</th><th>p10</th><th>p90</th><th>Min</th><th>Max</th></tr></thead><tbody>{fields.map(field => { const stats = summarize(rows.map(row => row[field])); return <tr key={field}><td>{field}</td><td>{stats?.count ?? 0}</td><td>{fmt(stats?.median, 3)}</td><td>{fmt(stats?.mean, 3)}</td><td>{fmt(stats?.std, 3)}</td><td>{fmt(stats?.p10, 3)}</td><td>{fmt(stats?.p90, 3)}</td><td>{fmt(stats?.min, 3)}</td><td>{fmt(stats?.max, 3)}</td></tr>; })}</tbody></table></div></section>; })}</details>
    <details style={{ marginTop: 8 }}><summary>Baseline thresholds under evaluation</summary><p>Yaw âˆ’18Â° / +18Â° Â· pitch âˆ’14Â° / +18Â° Â· gaze ratio 0.37 / 0.63. No threshold is selected until measured pose distributions are exported and reviewed.</p></details>
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button type="button" onClick={exportData} disabled={!Object.values(collections).some(row => row?.samples.length)}>Export numeric JSON</button><button type="button" onClick={clear} disabled={recording}>Clear session samples</button></div>
  </section>;
}
