'use client';
import { useState } from 'react';
export function Tabs({ items }: { items: string[] }) { const [active, setActive] = useState(items[0]); return <div className="ui-tabs">{items.map(item => <button type="button" key={item} aria-pressed={active === item} className={active === item ? 'active' : ''} onClick={() => setActive(item)}>{item}</button>)}</div>; }
